# Go 프로젝트 타입 지원 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `project-auto-wizard`가 Go 프로젝트(백엔드 서버·CLI 도구)를 project_type `"go"`로 감지·설치할 수 있게 한다.

**Architecture:** 기존 9개 타입(spring/flutter/next/react/react-native/react-native-expo/node/python/basic)이 이미 사용하는 "마커 파일 감지 → 타입별 CLI/CD 워크플로우 배치 → 버전 동기화(또는 no-op)" 파이프라인에 `go`를 열 번째 타입으로 추가한다. Go는 `go.mod` 마커로 감지되고, 버전은 git 태그 기반(동기화 no-op)이며, CI는 python과 다르게 Dockerfile 없이 `go test/vet/build`로 동작하고, SIMPLE-CICD/PR-PREVIEW는 python의 Docker+SSH 배포 템플릿을 포팅한다.

**Tech Stack:** Node.js(감지/CLI/테스트), Python(`version_manager.py` 버전 동기화), GitHub Actions YAML(설치되는 워크플로우), `node --test` + `unittest`(테스트 러너).

**Spec:** `docs/superpowers/specs/2026-08-23-go-project-type-support-design.md`

## Global Constraints

- 커밋 메시지는 한국어로 작성한다 (Conventional Commits 타입 접두사는 영어 유지) — `CLAUDE.md`.
- v1은 레포 루트 `go.mod` 단일 모듈 전제만 지원한다. go.work 멀티모듈은 범위 밖.
- `-ldflags` 버전 빌드 인젝션 자동화는 범위 밖 — 사용자가 CI에서 직접 다룬다.
- `PYTHON_VERSION` 하드코딩 정리는 별도 이슈 [#99](https://github.com/Twin-Fang/project-auto-wizard/issues/99)이며 이 계획에 포함하지 않는다. Go 쪽에 동일한 죽은 변수를 새로 만들지 않는다(SIMPLE-CICD 포팅 시 `PYTHON_VERSION` 라인은 삭제하고 대응 `GO_VERSION` 변수를 추가하지 않는다).
- spring의 `server-deploy/` 무중단 배포 변형(NONSTOP-TRAEFIK-CICD 등)은 범위 밖 — python과 동일한 3종(CI/SIMPLE-CICD/PR-PREVIEW) 패리티만 목표.
- 모든 신규/변경 테스트는 구현보다 먼저 작성한다(TDD) — RED 확인 후 GREEN.

---

### Task 1: `detect.js` — go.mod 마커 감지

**Files:**
- Modify: `src/core/detect.js:22-33` (`detectTypesFromMarkers`), `src/core/detect.js:75-77` (`markerForType`)
- Test: `tests/node/detect-accuracy.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수, 기존 시그니처 유지)
- Produces: `detectTypesFromMarkers({has, read})`가 `go.mod`만 있을 때 `["go"]`를 반환. `markerForType("go")`가 `"go.mod"`를 반환. 이후 모든 태스크가 이 두 반환값에 의존한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/detect-accuracy.test.js`의 import 목록(9~11행)에 `detectTypesFromMarkers`, `markerForType`을 추가한다:

```js
import {
  detectVersionFromFiles, versionFromPom, detectJdkFromFiles, resolveMarker, resolveMarkers,
  detectTypesFromMarkers, markerForType,
} from "../../src/core/detect.js";
```

"── 마커 (#77) ──" 섹션(66행) 바로 아래, `resolveMarker` 테스트들 사이 또는 뒤에 아래 3개 테스트를 추가한다:

```js
test("detectTypesFromMarkers: go.mod만 있으면 [\"go\"]를 반환한다", () => {
  const types = detectTypesFromMarkers({ has: (n) => n === "go.mod", read: () => null });
  assert.deepStrictEqual(types, ["go"]);
});

test("detectTypesFromMarkers: go.mod와 package.json이 함께 있으면 두 타입 모두 감지한다", () => {
  const has = (n) => n === "go.mod" || n === "package.json";
  const read = (n) => (n === "package.json" ? '{"name":"x"}' : null);
  const types = detectTypesFromMarkers({ has, read });
  assert.deepStrictEqual(types, ["go", "node"]);
});

test("markerForType: go는 go.mod를 반환한다 (package.json 폴백 금지)", () => {
  assert.strictEqual(markerForType("go"), "go.mod");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/detect-accuracy.test.js`
Expected: 위 3개 테스트 FAIL (`go`가 감지되지 않거나 `markerForType`이 `"package.json"`을 반환).

- [ ] **Step 3: 최소 구현**

`src/core/detect.js:22-33`의 `detectTypesFromMarkers`를 아래로 교체(python 체크와 package.json 체크 사이에 go.mod 체크 삽입):

```js
export function detectTypesFromMarkers({ has, read }) {
  const types = [];
  if (has("pubspec.yaml")) types.push("flutter");
  if (has("build.gradle") || has("build.gradle.kts") || has("pom.xml")) types.push("spring");
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) types.push("python");
  if (has("go.mod")) types.push("go");
  if (has("package.json")) {
    const cls = classifyPackageText(read ? read("package.json") : "");
    if (cls === "node") { if (types.length === 0) types.push("node"); }
    else types.push(cls);
  }
  return types.length ? [...new Set(types)] : ["basic"];
}
```

`src/core/detect.js:75-77`의 `markerForType`을 아래로 교체:

```js
export function markerForType(type) {
  return { flutter: "pubspec.yaml", "react-native-expo": "app.json", python: "pyproject.toml", spring: "build.gradle", go: "go.mod" }[type] || "package.json";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/detect-accuracy.test.js`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/core/detect.js tests/node/detect-accuracy.test.js
git commit -m "feat: Go 프로젝트(go.mod) 마커 감지 추가"
```

---

### Task 2: `paths-resolve.js` — Go project_paths 해석 지원 (⚠️ 필수·차단급)

**Files:**
- Modify: `src/core/paths-resolve.js:20-25` (`KNOWN_MARKER_TYPES`/`markerForType`), `src/core/paths-resolve.js:75-82` (`findTypePathCandidates`의 `namesByType`)
- Test: `tests/node/paths-resolve.test.js`

**Interfaces:**
- Consumes: Task 1의 `detectTypesFromMarkers`가 반환하는 `"go"` 타입 문자열
- Produces: `resolveProjectPaths({root, types: ["go"], ...})`가 루트에 `go.mod`가 있으면 `result.get("go") === "."`를 반환. 이게 없으면 `--force`(비대화형) 설치가 `CliError`로 실패한다 — 스펙 2.1b 참조.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/paths-resolve.test.js` 파일 끝(마지막 `test(...)` 블록 뒤)에 추가:

```js
test("resolveProjectPaths: go.mod이 루트에 있으면 자동으로 '.'로 확정된다 (KNOWN_MARKER_TYPES 회귀)", async () => {
  const root = mkdtempSync(join(tmpdir(), "paw-paths-resolve-"));
  try {
    writeFileSync(join(root, "go.mod"), "module example.com/fx\n\ngo 1.23\n");
    const result = await resolveProjectPaths({
      root, types: ["go"], paths: new Map(),
      existingPaths: new Map(), force: true, tty: false, io: {},
    });
    assert.strictEqual(result.get("go"), ".");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: FAIL — `resolveProjectPaths`가 `CliError: go: 프로젝트 경로를 찾지 못했습니다. --paths "go=경로"로 직접 지정하세요.`를 던짐.

- [ ] **Step 3: 최소 구현**

`src/core/paths-resolve.js:20-22`의 `KNOWN_MARKER_TYPES`를 교체:

```js
const KNOWN_MARKER_TYPES = new Set([
  "flutter", "react", "next", "node", "react-native", "react-native-expo", "python", "spring", "go",
]);
```

`src/core/paths-resolve.js:75-82`의 `namesByType`를 교체:

```js
  const namesByType = {
    flutter: ["pubspec.yaml"],
    react: ["package.json"], next: ["package.json"], node: ["package.json"],
    "react-native": ["package.json"],
    "react-native-expo": ["app.json"],
    python: ["pyproject.toml", "setup.py", "requirements.txt"],
    spring: ["build.gradle", "build.gradle.kts", "pom.xml"],
    go: ["go.mod"],
  };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/paths-resolve.test.js`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/core/paths-resolve.js tests/node/paths-resolve.test.js
git commit -m "fix: paths-resolve.js에 go 타입 등록 (--force 설치 차단 버그 수정)"
```

---

### Task 3: `version_manager.py` — Go 버전 동기화 no-op 처리

**Files:**
- Modify: `.github/scripts/version_manager.py:426-429` (`sync_for_type`의 `basic`/`else` 분기)
- Test: `tests/py/test_version_manager.py`

**Interfaces:**
- Consumes: 없음 (독립적인 분기 추가)
- Produces: `version_manager.sync_for_type("go", new_version, version_code_getter)` 호출이 예외 없이, `WARNING` 로그 없이 조용히 반환됨.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/py/test_version_manager.py`의 `TestSetVersionCodeRegressionGuard` 클래스(131~153행) 뒤, 파일 끝에 새 클래스를 추가:

```python
class TestSyncForTypeGo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)
        Path("version.yml").write_text('version: "1.0.0"\n', encoding="utf-8")

    def test_go_is_treated_like_basic_no_warning(self):
        stderr = _io.StringIO()
        with contextlib.redirect_stderr(stderr):
            version_manager.sync_for_type("go", "1.2.3", lambda: 1)
        self.assertNotIn("WARNING", stderr.getvalue())
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.py.test_version_manager.TestSyncForTypeGo -v` (프로젝트 루트에서 실행, 필요 시 `PYTHONPATH` 없이 `cd` 후 `python3 -m unittest discover -s tests/py -p "test_version_manager.py"`)
Expected: FAIL — stderr에 `"WARNING: unknown project type: go — skipping"`가 포함되어 `assertNotIn` 실패.

- [ ] **Step 3: 최소 구현**

`.github/scripts/version_manager.py`의 `sync_for_type` 함수(412~429행) 중 `basic` 분기 바로 아래에 삽입:

```python
    elif project_type == "basic":
        pass
    elif project_type == "go":
        pass
    else:
        log(f"WARNING: unknown project type: {project_type} — skipping")
```

(기존 426~429행의 `basic`/`else` 두 줄 사이에 `elif project_type == "go": pass`를 끼워 넣는 형태.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `python3 -m unittest tests.py.test_version_manager.TestSyncForTypeGo -v`
Expected: PASS. 이어서 `npm run test:py`로 회귀 없는지 전체 확인.

- [ ] **Step 5: 커밋**

```bash
git add .github/scripts/version_manager.py tests/py/test_version_manager.py
git commit -m "feat: version_manager.py에 go 타입 버전 동기화 no-op 분기 추가"
```

---

### Task 4: CLI 타입 검증/안내 3곳 (`context.js`, `prompts.js`, `help.js`)

**Files:**
- Modify: `src/context.js:2-5` (`VALID_TYPES`), `src/ui/prompts.js:51` (`ALL_TYPES`), `src/cli/help.js:13-14` (도움말 텍스트)
- Test: `tests/node/args-validation.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `parseArgs(["--type", "go"])`가 `CliError` 없이 `{types: ["go"], primaryType: "go"}`를 반환. 대화형 `selectTypes()`/`confirmTypes()`(prompts.js)의 옵션 목록에 `go`가 포함됨.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/args-validation.test.js` 파일 끝에 추가:

```js
test("parseArgs: --type go는 지원 타입으로 통과한다", () => {
  const opts = parseArgs(["--type", "go"]);
  assert.deepStrictEqual(opts.types, ["go"]);
  assert.strictEqual(opts.primaryType, "go");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: FAIL — `CliError: 지원하지 않는 타입: 'go'`.

- [ ] **Step 3: 최소 구현**

`src/context.js:2-5`를 교체:

```js
export const VALID_TYPES = [
  "spring", "flutter", "next", "react",
  "react-native", "react-native-expo", "node", "python", "basic", "go",
];
```

`src/ui/prompts.js:51`을 교체:

```js
const ALL_TYPES = ["spring", "flutter", "next", "react", "react-native", "react-native-expo", "node", "python", "basic", "go"];
```

`src/cli/help.js:13-14`를 교체:

```
  -t, --type CSV           프로젝트 타입 csv (예: spring,react,python)
                           지원: spring flutter next react react-native
                                 react-native-expo node python basic go
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/context.js src/ui/prompts.js src/cli/help.js tests/node/args-validation.test.js
git commit -m "feat: CLI 검증·대화형 선택·도움말에 go 타입 등록"
```

---

### Task 5: `payload/workflows/go/PROJECT-GO-CI.yaml` 신규 작성

**Files:**
- Create: `payload/workflows/go/PROJECT-GO-CI.yaml`
- Modify: `tests/node/workflow-action-versions.test.js:15-24` (`MIN_MAJOR`에 `actions/setup-go` 등록)

**Interfaces:**
- Consumes: 없음 (독립 신규 파일)
- Produces: `payload/workflows/go/` 디렉토리와 그 안의 `PROJECT-GO-CI.yaml` — Task 9(문서)·Task 10(e2e)이 이 파일의 존재를 전제로 한다.

- [ ] **Step 1: 파일 작성**

`payload/workflows/go/PROJECT-GO-CI.yaml`을 새로 작성한다 (디렉토리가 없으면 자동 생성됨):

```yaml
# project-auto-wizard:managed-workflow
# ===================================================================
# Go 빌드 검증 워크플로우 (CI Only)
# ===================================================================
#
# 설명:
# - {{DEVELOP_BRANCH}} 브랜치에 push/PR 시 go build/vet/test/lint로 검증
# - Dockerfile이 필요 없어 CLI 도구·라이브러리 등 배포하지 않는 Go 프로젝트도 사용 가능
# - go.mod의 go 지시자 버전을 자동으로 사용 (버전 하드코딩 없음)
#
# ===================================================================

name: PROJECT-GO-CI

# ===================================================================
# 트리거 설정
# ===================================================================
on:
  push:
    branches:
      - "{{DEVELOP_BRANCH}}"  # {{DEVELOP_BRANCH}} 브랜치 push 시 빌드 검증
  pull_request:
    branches:
      - "{{DEVELOP_BRANCH}}"  # {{DEVELOP_BRANCH}} 브랜치로의 PR 시 빌드 검증
  workflow_dispatch:  # 수동 실행 허용

# ===================================================================
# 환경 변수 설정
# ===================================================================
env:
  # 프로젝트 고유 식별자
  PROJECT_NAME: "__PROJECT_NAME__"  # @wizard ask:@repo

jobs:
  # ===================================================================
  # 빌드 검증 작업
  # ===================================================================
  build-check:
    name: Go 빌드 검증
    runs-on: ubuntu-latest

    steps:
      # 1. 소스코드 체크아웃
      - name: 코드 체크아웃
        uses: actions/checkout@v7

      # 2. Go 툴체인 설정 (go.mod의 go 지시자 버전 자동 사용)
      - name: Go 설정
        uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true

      # 3. 빌드 검증
      - name: go build 검증
        run: go build ./...

      # 4. 정적 분석
      - name: go vet 검증
        run: go vet ./...

      # 5. 테스트 실행
      - name: go test 실행
        run: go test ./...

      # 6. 린트
      - name: golangci-lint
        uses: golangci/golangci-lint-action@v6
        with:
          version: latest

      # 7. 빌드 검증 완료 메시지
      - name: 빌드 검증 완료
        run: |
          echo "✅ Go 빌드 검증이 성공적으로 완료되었습니다!"
          echo ""
          echo "📋 빌드 정보:"
          echo "  🎯 프로젝트: ${{ env.PROJECT_NAME }}"
          echo "  🌿 브랜치: ${{ github.ref_name }}"
          echo "  📝 커밋: ${{ github.sha }}"
          echo "  ⏰ 검증 시간: $(date '+%Y-%m-%d %H:%M:%S')"
```

- [ ] **Step 2: 액션 버전 하한 등록**

`tests/node/workflow-action-versions.test.js:15-24`의 `MIN_MAJOR`에 `"actions/setup-go": 5,`를 추가(다른 항목과 같은 스타일로, 알파벳 순서 무관하게 목록 끝에 추가):

```js
const MIN_MAJOR = {
  "actions/checkout": 7,
  "actions/setup-node": 7,
  "actions/setup-python": 7,
  "actions/setup-java": 5,
  "actions/cache": 6,
  "actions/upload-artifact": 7,
  "actions/download-artifact": 8,
  "actions/github-script": 9,
  "actions/setup-go": 5,
};
```

- [ ] **Step 3: 검증**

Run: `node --test tests/node/workflow-action-versions.test.js`
Expected: PASS (하한 미달 없음, 메이저 버전 혼재 없음).

Run(YAML 문법 sanity check, 정식 테스트는 아니지만 오타 방지): `python3 -c "import yaml; yaml.safe_load(open('payload/workflows/go/PROJECT-GO-CI.yaml'))" && echo OK`
Expected: `OK` 출력.

- [ ] **Step 4: 커밋**

```bash
git add payload/workflows/go/PROJECT-GO-CI.yaml tests/node/workflow-action-versions.test.js
git commit -m "feat: Go CI 워크플로우(PROJECT-GO-CI) 추가"
```

---

### Task 6: `payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml` 포팅

**Files:**
- Create: `payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml` (python 파일 복사 후 수정)
- Reference: `payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml` (387줄, 전체 포팅 대상)

**Interfaces:**
- Consumes: 없음
- Produces: `payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml` — Task 9·10이 전제.

- [ ] **Step 1: 파일 복사**

```bash
cp payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml
```

- [ ] **Step 2: Go 관례로 치환 (Edit 도구로 아래 6곳을 정확히 교체)**

`payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml`에서:

1) (3행)
- old: `# Python FastAPI CI/CD 배포 (SSH + Docker)`
- new: `# Go CI/CD 배포 (SSH + Docker)`

2) (25행)
- old: `# CONTAINER_INTERNAL_PORT: FastAPI 내부 포트 (기본: 8000)`
- new: `# CONTAINER_INTERNAL_PORT: Go 앱 내부 포트 (기본: 8080)`

3) (47행)
- old: `#   FastAPI: "/docs"`
- new: `#   Go (net/http 등): "/health"`

4) (51행)
- old: `name: PROJECT-PYTHON-SIMPLE-CICD`
- new: `name: PROJECT-GO-SIMPLE-CICD`

5) (71~77행 — `DEPLOY_PORT` 기본값 예시를 8080으로 바꾸고 죽은 `PYTHON_VERSION` 변수를 통째로 제거, 이슈 #99와 동일한 문제를 새로 만들지 않는다)
- old:
```
  DEPLOY_PORT: "__DEPLOY_PORT__"  # @wizard ask:8000

  # 🐍 Python 설정
  PYTHON_VERSION: "3.13"

  # 🐳 컨테이너 이름 설정 (비워두면 PROJECT_NAME 사용)
```
- new:
```
  DEPLOY_PORT: "__DEPLOY_PORT__"  # @wizard ask:8080

  # 🐳 컨테이너 이름 설정 (비워두면 PROJECT_NAME 사용)
```

6) (95행)
- old: `  CONTAINER_INTERNAL_PORT: "8000"  # FastAPI 내부 포트`
- new: `  CONTAINER_INTERNAL_PORT: "8080"  # Go 앱 내부 포트`

7) (99행)
- old: `  HEALTHCHECK_PATH: "/docs"  # HTTP 엔드포인트 경로 (비어있으면 로그 패턴만 사용)`
- new: `  HEALTHCHECK_PATH: "/health"  # HTTP 엔드포인트 경로 (비어있으면 로그 패턴만 사용)`

8) (102행)
- old: `  HEALTHCHECK_LOG_PATTERN: "Uvicorn running on"  # Fallback 로그 검색 패턴`
- new: `  HEALTHCHECK_LOG_PATTERN: "listening on"  # Fallback 로그 검색 패턴 (프로젝트 로그 문구에 맞게 조정)`

9) (109행)
- old: `    name: Python FastAPI 애플리케이션 빌드`
- new: `    name: Go 애플리케이션 빌드`

10) (387행)
- old: `            echo "🔗 접속 URL: http://${{ secrets.SERVER_HOST }}:${PORT}/docs"`
- new: `            echo "🔗 접속 URL: http://${{ secrets.SERVER_HOST }}:${PORT}"`

- [ ] **Step 3: 검증**

Run: `python3 -c "import yaml; yaml.safe_load(open('payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml'))" && echo OK`
Expected: `OK`.

Run: `grep -ci "python\|fastapi\|uvicorn" payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml`
Expected: `0` (모든 python 흔적 제거 확인).

- [ ] **Step 4: 커밋**

```bash
git add payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml
git commit -m "feat: python SIMPLE-CICD 템플릿을 포팅해 Go SIMPLE-CICD 워크플로우 추가"
```

---

### Task 7: `payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml` 포팅

**Files:**
- Create: `payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml` (python 파일 복사 후 수정)
- Reference: `payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml` (2192줄, 전체 포팅 대상)

**Interfaces:**
- Consumes: 없음
- Produces: `payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml` — Task 9·10이 전제.

- [ ] **Step 1: 파일 복사**

```bash
cp payload/workflows/python/PROJECT-PYTHON-PR-PREVIEW.yaml payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml
```

- [ ] **Step 2: Go 관례로 치환 (Edit 도구로 아래 7곳을 정확히 교체 — 마지막 1곳은 3회 반복 등장하므로 replace_all)**

`payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml`에서:

1) (3행)
- old: `# Python/FastAPI PR Preview (SSH + Docker + Traefik)`
- new: `# Go PR Preview (SSH + Docker + Traefik)`

2) (35행)
- old: `name: PROJECT-PYTHON-PR-PREVIEW`
- new: `name: PROJECT-GO-PR-PREVIEW`

3) (46행)
- old: `  INTERNAL_PORT: '8000'`
- new: `  INTERNAL_PORT: '8080'`

4) (74~77행 — 프레임워크별 예시 주석에 Go 줄 추가, 기존 3줄은 그대로 보존)
- old:
```
  # 프레임워크별 기본값 예시:
  #   FastAPI: '/docs', 'Uvicorn running on|Application startup complete'
  #   Spring Boot: '/actuator/health', 'Started.*Application|Tomcat started on port'
  #   Express: '/health', 'Server listening on port'
```
- new:
```
  # 프레임워크별 기본값 예시:
  #   FastAPI: '/docs', 'Uvicorn running on|Application startup complete'
  #   Spring Boot: '/actuator/health', 'Started.*Application|Tomcat started on port'
  #   Express: '/health', 'Server listening on port'
  #   Go (net/http 등): '/health', 'listening on'
```

5) (78행)
- old: `  HEALTH_CHECK_PATH: '/docs'`
- new: `  HEALTH_CHECK_PATH: '/health'`

6) (79행)
- old: `  HEALTH_CHECK_LOG_PATTERN: 'Uvicorn running on|Application startup complete'`
- new: `  HEALTH_CHECK_LOG_PATTERN: 'listening on'`

7) (80행 — Go는 FastAPI의 `/docs` 같은 보편적 API 문서 경로 관례가 없으므로 빈 값으로 시작. 파일 자체 주석대로 "빈값이면 배포 코멘트에 미표시"됨)
- old: `  API_DOCS_PATH: '/docs'`
- new: `  API_DOCS_PATH: ''`

8) (589~590행, 1183~1184행, 1916~1917행 — 3곳에 동일하게 등장. Edit 도구의 `replace_all: true`로 한 번에 처리)
- old:
```
              '- Docker 이미지 빌드 실패 (Python 의존성 문제)',
              '- 컨테이너 시작 실패 (FastAPI/Uvicorn 기동 오류)',
```
- new:
```
              '- Docker 이미지 빌드 실패 (Go 의존성/빌드 문제)',
              '- 컨테이너 시작 실패 (애플리케이션 기동 오류)',
```
(`replace_all: true`로 지정하면 3곳 모두 한 번에 교체된다.)

- [ ] **Step 3: 검증**

Run: `python3 -c "import yaml; yaml.safe_load(open('payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml'))" && echo OK`
Expected: `OK`.

Run: `grep -c "PYTHON\|FastAPI\|Uvicorn" payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml`
Expected: `0`.

- [ ] **Step 4: 커밋**

```bash
git add payload/workflows/go/PROJECT-GO-PR-PREVIEW.yaml
git commit -m "feat: python PR-PREVIEW 템플릿을 포팅해 Go PR-PREVIEW 워크플로우 추가"
```

---

### Task 8: `version.yml` 헤더 + `README.md` 문서 갱신

**Files:**
- Modify: `version.yml:10-11` (지원 타입 목록), `version.yml:17-24` (타입별 동기화 파일 주석)
- Modify: `README.md:40,46,50,65-75` (타입 개수·목록·워크플로우 구성 섹션)

**Interfaces:**
- Consumes: 없음 (순수 문서)
- Produces: 없음 (다른 태스크가 의존하지 않는 문서 전용 변경)

- [ ] **Step 1: `version.yml` 헤더 갱신**

`version.yml:10-11`을 교체:

```
# Supported project types: spring, flutter, next, react, react-native,
#                          react-native-expo, node, python, basic, go
```

`version.yml:17-24`의 "Synced files per type" 블록에서 `python`과 `basic` 사이에 go 줄을 추가:

- old:
```
# Synced files per type:
# - spring: build.gradle / build.gradle.kts
# - flutter: pubspec.yaml
# - next/react/node: package.json
# - react-native: Info.plist + build.gradle
# - react-native-expo: app.json
# - python: pyproject.toml
# - basic: version.yml only
```
- new:
```
# Synced files per type:
# - spring: build.gradle / build.gradle.kts
# - flutter: pubspec.yaml
# - next/react/node: package.json
# - react-native: Info.plist + build.gradle
# - react-native-expo: app.json
# - python: pyproject.toml
# - go: (none — git tag based, go.mod has no version field)
# - basic: version.yml only
```

- [ ] **Step 2: `README.md` 갱신**

`README.md:40`을 교체:
- old: `| ① **npx 마법사** | 마커 파일로 프로젝트 타입 자동 감지 — **9타입 + 멀티타입 + 모노레포 경로**까지. 질문은 최소한만 |`
- new: `| ① **npx 마법사** | 마커 파일로 프로젝트 타입 자동 감지 — **10타입 + 멀티타입 + 모노레포 경로**까지. 질문은 최소한만 |`

`README.md:46`을 교체:
- old: `` `spring` `flutter` `react` `next` `node` `python` `react-native` `react-native-expo` `basic` ``
- new: `` `spring` `flutter` `react` `next` `node` `python` `react-native` `react-native-expo` `basic` `go` ``

`README.md:50`을 교체:
- old: `- \`spring\`/\`flutter\`/\`react\`/\`next\`/\`python\` 5개 타입은 아래 "타입별 워크플로우 구성"처럼 전용 CI/CD가 설치됩니다. \`node\`/\`react-native\`/\`react-native-expo\`/\`basic\`은 타입 전용 CI 없이 릴리스 자동화(버전 관리·체인지로그·AI 요약)를 담당하는 공통 워크플로우만 설치됩니다 — 빌드/배포 CI는 직접 추가해서 확장할 수 있습니다.`
- new: `- \`spring\`/\`flutter\`/\`react\`/\`next\`/\`python\`/\`go\` 6개 타입은 아래 "타입별 워크플로우 구성"처럼 전용 CI/CD가 설치됩니다. \`node\`/\`react-native\`/\`react-native-expo\`/\`basic\`은 타입 전용 CI 없이 릴리스 자동화(버전 관리·체인지로그·AI 요약)를 담당하는 공통 워크플로우만 설치됩니다 — 빌드/배포 CI는 직접 추가해서 확장할 수 있습니다.`

`README.md:75`(python 워크플로우 구성 줄) 바로 뒤에 go 줄을 추가:
- old:
```
- **python**: CI / PR 프리뷰 / SimpleCICD
```
- new:
```
- **python**: CI / PR 프리뷰 / SimpleCICD
- **go**: CI(Dockerfile 불필요, go test/vet/build/lint) / PR 프리뷰 / SimpleCICD(Dockerfile 있는 프로젝트만 해당)
```

- [ ] **Step 3: 검증**

Run: `grep -n "10타입\|go\`" README.md | head -5` — 반영 여부 육안 확인.
Run: `npm run test:node -- --test-name-pattern="워크플로우가 하한"` 등 관련 없는 테스트 회귀가 없는지 `npm test` 전체 한 번 실행(문서 변경이 테스트를 깨뜨리지 않는지 최종 확인은 Task 10에서 겸함).

- [ ] **Step 4: 커밋**

```bash
git add version.yml README.md
git commit -m "docs: version.yml·README에 go 프로젝트 타입 반영"
```

---

### Task 9: e2e fixture + `e2e-matrix.test.js` MATRIX 항목 (통합 검증 게이트)

**Files:**
- Create: `tests/fixtures/e2e/go/go.mod`
- Modify: `tests/node/e2e-matrix.test.js:50-62` (`MATRIX` 배열)

**Interfaces:**
- Consumes: Task 1~8에서 만든 모든 산출물(감지, paths-resolve, 버전 동기화, CLI 검증, 3개 워크플로우 파일, 문서) — 이 태스크가 전체 파이프라인을 실제 CLI 서브프로세스로 end-to-end 검증하는 최종 게이트다.
- Produces: 없음 (최종 태스크)

- [ ] **Step 1: fixture 작성**

`tests/fixtures/e2e/go/go.mod`를 새로 작성 (디렉토리 자동 생성):

```
module example.com/fx

go 1.23
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/node/e2e-matrix.test.js:50-62`의 `MATRIX` 배열에서, `python` 항목(56행) 바로 뒤에 go 항목을 추가:

```js
const MATRIX = [
  { name: "spring", args: ["--type", "spring"], expect: ["PROJECT-SPRING-SIMPLE-CICD.yaml"], absent: ["PROJECT-SPRING-NEXUS-PUBLISH.yml"] },
  { name: "flutter", args: ["--type", "flutter"], expect: ["PROJECT-FLUTTER-CI.yaml", "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"] },
  { name: "react", args: ["--type", "react"], expect: ["PROJECT-REACT-CI.yaml", "PROJECT-REACT-CICD.yaml"] },
  { name: "next", args: ["--type", "next"], expect: ["PROJECT-NEXT-CI.yaml", "PROJECT-NEXT-CICD.yaml"] },
  { name: "node", args: ["--type", "node"], expect: [] },
  { name: "python", args: ["--type", "python"], expect: ["PROJECT-PYTHON-CI.yaml", "PROJECT-PYTHON-SIMPLE-CICD.yaml"] },
  { name: "go", args: ["--type", "go"], expect: ["PROJECT-GO-CI.yaml", "PROJECT-GO-SIMPLE-CICD.yaml"] },
  { name: "react-native", args: ["--type", "react-native"], expect: [] },
  { name: "react-native-expo", args: ["--type", "react-native-expo"], expect: [] },
  { name: "basic", args: ["--type", "basic"], expect: [] },
  { name: "multi", args: ["--type", "spring,react"], expect: ["PROJECT-SPRING-SIMPLE-CICD.yaml", "PROJECT-REACT-CICD.yaml"] },
  { name: "monorepo", args: ["--type", "flutter,react", "--paths", "flutter=app,react=client"], expect: ["PROJECT-FLUTTER-CI.yaml", "PROJECT-REACT-CICD.yaml"] },
];
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --test tests/node/e2e-matrix.test.js`
Expected: 이 계획의 모든 이전 태스크가 완료된 상태라면 이미 PASS해야 정상이다. 만약 Task 1~8 중 하나라도 누락되었다면 여기서 실패한다 — 실패 메시지로 어느 태스크가 빠졌는지 역추적한다(예: `go: 프로젝트 경로를 찾지 못했습니다` → Task 2 누락, `PROJECT-GO-CI.yaml expected` 실패 → Task 5 누락).

- [ ] **Step 4: 전체 테스트 스위트 최종 확인**

Run: `npm test`
Expected: 전체(node 465+ / py 130+) PASS, 0 fail.

- [ ] **Step 5: 커밋**

```bash
git add tests/fixtures/e2e/go/go.mod tests/node/e2e-matrix.test.js
git commit -m "test: go 프로젝트 타입 e2e 설치 매트릭스 추가"
```
