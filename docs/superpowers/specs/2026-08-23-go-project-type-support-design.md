# Go 프로젝트 타입 지원 추가 — 설계 스펙

- 날짜: 2026-08-23
- 상태: 사용자 승인된 설계 (브레인스토밍 완료, `/goal` 자동 진행)
- 관련 이슈: [Twin-Fang/project-auto-wizard#92](https://github.com/Twin-Fang/project-auto-wizard/issues/92)

## 1. 배경 / 문제

`version.yml` 주석 기준 지원되는 `project_types`는 `spring, flutter, next, react, react-native, react-native-expo, node, python, basic`이며, `payload/workflows/`에도 `common, flutter, next, python, react, spring` 디렉토리만 있다. Go로 작성된 프로젝트(백엔드 서버, CLI 도구 등)는 project_type으로 감지·설치가 불가능하다.

Go는 다른 언어들과 달리 매니페스트 파일(`go.mod`) 안에 버전 필드가 없다 — `go.mod`는 `module <경로>`와 `go <버전>` 지시자만 가지며, Go 모듈 버전은 관례상 git 태그가 진실이다.

브레인스토밍 과정에서 이슈 작성자가 언급하지 않은 추가 접점 3곳(`src/context.js`, `src/ui/prompts.js`, `src/cli/help.js`)과, python 타입의 CI/CD 구조가 실제로는 "언어 네이티브 테스트"가 아니라 "Dockerfile 기반 배포 검증"이라는 사실을 확인했다. 이 차이는 CLI 도구·라이브러리처럼 Dockerfile이 없는 Go 프로젝트가 CI를 아예 못 쓰게 만들 수 있어, Go의 CI는 python을 그대로 베끼지 않고 별도로 설계한다.

## 2. 설계 결정

### 2.1 감지: 누적형 마커 배열에 한 줄 추가

`src/core/detect.js`의 `detectTypesFromMarkers()`(22~33행)는 else-if 배타적 분기가 아니라 각 마커를 독립적으로 체크해 `types` 배열에 누적하는 구조다 (모노레포/multi-type을 이 방식으로 지원). 따라서 Go 감지는 기존 패턴에 한 줄만 추가하면 되고, 다른 타입과의 동시 감지도 자동으로 호환된다.

```js
if (has("go.mod")) types.push("go");
```

**버그 수정 포함**: `markerForType()`(75~77행)은 매칭되지 않는 타입에 `"package.json"`을 기본 반환한다. `go` 엔트리를 추가하지 않으면 설치 로그에 "package.json 발견"이라고 잘못 출력된다.

```js
export function markerForType(type) {
  return { flutter: "pubspec.yaml", "react-native-expo": "app.json", python: "pyproject.toml", spring: "build.gradle", go: "go.mod" }[type] || "package.json";
}
```

`extraMarkers()`(79~81행)는 go.mod가 유일한 마커이므로 변경 불필요.

**버전 감지는 변경 불필요**: `detectVersionFromFiles()`(41~64행)는 이미 매칭되는 매니페스트 패턴이 없으면 `gitTag` 폴백 → 기본값 `0.0.1`까지 흘러간다. go.mod에 매칭시킬 버전 정규식 자체가 없으므로, go 프로젝트는 자연히 git 태그 감지(Go 커뮤니티 관례와 정확히 일치)로 떨어진다. `detectBuildNumberFromFiles()`/`detectJdkFromFiles()`도 flutter/react-native/gradle 전용 분기라 go는 자연히 통과(null 반환)한다.

### 2.1b `project_paths` 해석 — 별도 타입 레지스트리 (이슈 미기재, 계획 작성 중 발견, **필수·차단급**)

`src/core/paths-resolve.js`는 `detect.js`의 `markerForType`을 그대로 쓰지 않고 **자체 `KNOWN_MARKER_TYPES` Set(20~22행)으로 한 번 더 감싼다**:

```js
const KNOWN_MARKER_TYPES = new Set([
  "flutter", "react", "next", "node", "react-native", "react-native-expo", "python", "spring",
]);
export function markerForType(type) {
  return KNOWN_MARKER_TYPES.has(type) ? baseMarkerForType(type) : "";
}
```

여기에 `go`가 없으면 `markerForType("go")`가 빈 문자열을 반환하고, `existingMarkerInDir("go", dir)`(29~32행)도 즉시 빈 문자열로 단락(short-circuit)된다. 이 값은 `resolveProjectPaths()`(119~262행)의 "② 루트에 마커 존재 → `.` 자동 확정"(153~159행) 분기에서 쓰이는데, 이 분기가 아예 작동하지 않게 된다.

게다가 `findTypePathCandidates()`(62~110행)의 `namesByType` 맵(75~82행)에도 `go` 엔트리가 없어 `names`가 `undefined`가 되고(83~84행) 후보 검색이 항상 빈 배열을 반환한다.

결과적으로 **`go.mod`가 감지되어도, `--force`(비대화형) 모드에서는 `resolveProjectPaths()`가 `CliError("go: 프로젝트 경로를 찾지 못했습니다...")`를 던져 설치 자체가 실패한다.** 단일 모듈 레포 루트라는 가장 기본적인 케이스조차 막히므로 이 두 곳은 감지 로직(2.1)만큼이나 필수다.

**수정:**
1. `KNOWN_MARKER_TYPES`에 `"go"` 추가
2. `namesByType`에 `go: ["go.mod"]` 추가

### 2.2 버전 동기화: `basic`과 동일하게 명시적 `pass`

`.github/scripts/version_manager.py`의 `sync_for_type()`(412~429행)은 매칭되지 않는 타입을 `else: log(f"WARNING: unknown project type: ...")`로 처리한다 — `basic`처럼 조용히 넘어가려면 반드시 명시적 분기가 필요하다.

```python
elif project_type == "go":
    pass
```

`basic` 분기(426~427행) 바로 아래에 추가한다.

### 2.3 CLI 검증 / 대화형 선택 (이슈 미기재, 조사로 발견)

세 곳 모두 동일한 9종 타입 배열을 하드코딩하고 있으며, `"go"`를 배열 끝에 추가한다.

| 파일 | 위치 |
|---|---|
| `src/context.js` | `VALID_TYPES` (2~5행) — `--type` CLI 인자 검증 |
| `src/ui/prompts.js` | `ALL_TYPES` (51행) — `selectTypes()`/`confirmTypes()` 대화형 멀티셀렉트 둘 다 사용 |
| `src/cli/help.js` | `--help` 텍스트 (12~14행) — 지원 타입 안내 줄 |

### 2.4 CI 워크플로우 — `payload/workflows/go/` (신규 디렉토리, 3개 파일)

python의 세 워크플로우(`PROJECT-PYTHON-CI.yaml`, `PROJECT-PYTHON-SIMPLE-CICD.yaml`, `PROJECT-PYTHON-PR-PREVIEW.yaml`)를 조사한 결과, **CI는 언어 네이티브 검증이 아니라 순수 `docker build` 검증**이고(Dockerfile 필수, `PYTHON_VERSION` env는 어디에도 참조되지 않는 죽은 선언 — 별도 이슈 #99로 분리 완료), **SIMPLE-CICD/PR-PREVIEW는 Docker+SSH 배포 인프라 템플릿**으로 사실상 언어 무관이다(Python 고유 부분은 healthcheck 예시 경로 `/docs`, 기본 포트 `8000` 정도의 주석/기본값뿐).

이 발견을 반영해 Go는 python과 다른 전략을 쓴다:

**`PROJECT-GO-CI.yaml`** (신규 설계, python과 다름):
- `actions/setup-go`를 `go-version-file: go.mod`로 사용 — go.mod의 `go` 지시자 버전을 자동 사용, 프로젝트마다 다른 버전에 자동 대응하고 하드코딩 유지보수 부담 없음 (python의 `PYTHON_VERSION: "3.13"` 하드코딩 문제를 반복하지 않음)
- `go build ./...` / `go vet ./...` / `go test ./...` / `golangci-lint-action`
- **Dockerfile 불필요** — CLI 도구·라이브러리 등 배포하지 않는 Go 프로젝트도 커버
- 트리거는 python CI와 동일 패턴: `{{DEVELOP_BRANCH}}` push/PR + `workflow_dispatch`

**`PROJECT-GO-SIMPLE-CICD.yaml` / `PROJECT-GO-PR-PREVIEW.yaml`** (python 템플릿 포팅):
- Docker+SSH 배포·Traefik PR 프리뷰 메커니즘 자체는 언어 무관이므로 python 파일을 기반으로 포팅
- 파일명·주석·기본값만 Go 관례에 맞게 교체: healthcheck 예시 경로 `/docs` → `/health`, 기본 내부 포트 `8000` → `8080`
- **Dockerfile이 있는 Go 프로젝트(백엔드 서버)에만 해당** — CLI 도구는 이 두 워크플로우를 설치하지 않아도 무방

### 2.5 문서 갱신

- `version.yml` 헤더 주석의 "Supported project types" 목록에 `go` 추가, "Synced files per type" 목록에 `go: (없음 — git tag 기반)` 한 줄 추가
- `README.md`의 타입 뱃지 목록과 "타입별 워크플로우 구성" 섹션(python이 CI/SIMPLE-CICD/PR-PREVIEW 3종을 갖는다는 서술 근처)에 go 추가

## 3. 테스트 계획 (TDD — 구현보다 먼저 작성)

1. **`tests/node/detect-accuracy.test.js`**: `go.mod`만 있는 경우 `["go"]` 반환, 다른 마커와 동시 존재 시 multi-type 배열에 `"go"`가 포함되는지 검증
2. **`tests/py/test_version_manager.py`**: `sync_for_type("go", ...)` 호출이 `WARNING` 로그를 남기지 않고 조용히 반환하는지 검증 (basic과 동일 취급 확인)
3. **`tests/fixtures/e2e/go/go.mod`** 신규 fixture(마커 파일 1개, 기존 11개 fixture와 동일 패턴) + `tests/node/e2e-matrix.test.js`의 `MATRIX` 배열(37~47행)에 12번째 항목 추가
4. **`paths-resolve.js` 회귀 테스트**: `markerForType("go")`가 `"go.mod"`를 반환하고, `findTypePathCandidates(root, "go")`가 루트의 `go.mod`를 후보로 찾는지 검증 — 2.1b에서 발견한 차단급 버그의 재발 방지

## 4. 범위 밖

- **go.work 멀티모듈 워크스페이스 감지**: v1은 레포 루트 `go.mod` 단일 모듈 전제만 지원. 모노레포 `project_paths` 매핑 자체는 기존 타입들과 동일하게 이미 범용으로 동작하므로 별도 구현 불필요하지만, go.work 기반 워크스페이스 분기는 다루지 않는다.
- **`-ldflags "-X main.version=..."` 빌드 인젝션**: 프로젝트마다 `main` 패키지 경로·변수명이 달라 일반화하기 어렵다. `version_manager.py`의 "파일 동기화" 책임이 아니라 CI 워크플로우의 빌드 스텝에서 사용자가 직접 다룰 영역.
- **`PYTHON_VERSION` 하드코딩/미사용 정리**: 별도 이슈 [#99](https://github.com/Twin-Fang/project-auto-wizard/issues/99)로 분리, 이번 작업 범위 아님.
- **spring의 `server-deploy/` 4종 변형(NONSTOP-TRAEFIK-CICD, NONSTOP-NGINX-CICD 등)**: python 3종 패리티만 목표로 하며, spring 수준의 무중단 배포 변형은 요청 범위 밖.
