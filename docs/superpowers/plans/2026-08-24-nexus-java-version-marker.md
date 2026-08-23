# Nexus 워크플로우 JAVA_VERSION 마커화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`과 `PROJECT-SPRING-NEXUS-PUBLISH.yml`에 하드코딩된 `java-version: '17'`을 다른 spring 배포 템플릿과 동일한 `@wizard ask:@jdk` 마커 패턴으로 교체하고, 이런 "마커가 통째로 빠진 템플릿"을 자동으로 잡아내는 회귀 테스트를 추가한다.

**Architecture:** GitHub 이슈 #82가 지적한 "`spring/nexus/*` 2개 파일 — 마커 0개, 전부 하드코딩" 항목은 이전 세션에서 `GITHUB-PACKAGES-PUBLISH.yml`만 고치고 같은 폴더의 `NEXUS-CI.yml`/`NEXUS-PUBLISH.yml`은 누락했다. 이미 검증된 패턴(`GITHUB-PACKAGES-PUBLISH.yml`)을 그대로 복제 적용한다 — 새 로직/리졸버는 필요 없다. `src/core/detect-fs.js`의 `@jdk` 리졸버(빌드 툴체인 실측, 실패 시 `"21"` 폴백)는 이미 모든 `@wizard ask:@jdk` 마커에 대해 범용으로 동작하므로 `src/` 변경은 없다. 회귀 테스트는 기존 `tests/node/payload-example-values.test.js`에 케이스를 추가하는 방식으로, "마커 붙은 줄만 검사"하던 기존 JAVA_VERSION 테스트의 사각지대(마커가 아예 없는 줄)를 별도 테스트로 메운다.

**Tech Stack:** Node.js 내장 테스트 러너(`node --test`), YAML 템플릿 파일(순수 텍스트, YAML 파서 라이브러리 없이 정규식/라인 기반 검사)

**Spec:** 없음 (Bounded 작업 — 브레인스토밍 세션에서 채팅으로 설계 확정, 별도 spec 문서 없음)

## Global Constraints

- 마커 표기는 겹따옴표 통일: `JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:@jdk` (기존 `payload-example-values.test.js`의 "겹따옴표 값" 테스트가 이를 강제한다)
- `@jdk` 리졸버는 `src/core/detect-fs.js:126`에 이미 존재 — 수정 금지, 재사용만 한다
- 참조 패턴 원본: `payload/workflows/spring/nexus/PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml` (env 블록: 51-52줄, setup-java 스텝: 60-64줄)
- 커밋 메시지는 한국어로 작성, Conventional Commits 타입 접두사(`feat:`, `fix:`, `test:` 등)만 영어 유지 (프로젝트 `CLAUDE.md`)
- PR 베이스는 `develop` (사용자 명시적 지정) — `Closes #82`는 GitHub에서 자동 링크/자동 클로즈되지 않는다 (default 브랜치가 아니므로). PR 설명에 이 사실을 명시하고, 머지 후 이슈를 수동으로 닫아야 한다.
- 이번 작업 범위는 payload 템플릿 2개 + 회귀 테스트 1개뿐이다. `NEXUS-CI.yml`의 기존 `permissions` 블록(PR 코멘트/체크 작성용)은 건드리지 않는다.

---

### Task 1: `NEXUS-PUBLISH`/`NEXUS-CI` java-version 하드코딩 검출 회귀 테스트 추가 (RED)

**Files:**
- Modify: `tests/node/payload-example-values.test.js`

**Interfaces:**
- Consumes: `resolvePayloadRoot()` (from `../../src/core/assets.js`), `parseWizardLine()` (from `../../src/core/wizard-env.js`) — 이미 파일 상단에 import되어 있음. 새 import 불필요.
- Produces: 없음 (테스트 파일 자체가 최종 산출물)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/payload-example-values.test.js` 마지막 테스트(`"spring DockerHub 자격증명 secret 이름이 워크플로우마다 갈리지 않는다"`, 89번째 줄에서 끝남) 바로 뒤에 아래 테스트를 추가한다:

```javascript
test("spring 워크플로우는 java-version을 리터럴로 하드코딩하지 않는다", () => {
  // NEXUS-CI/NEXUS-PUBLISH가 @wizard 마커 자체를 빠뜨린 채 java-version: '17'을 박아
  // 넣고 있었다(이슈 #82). 마커가 있는 줄만 보는 위 JAVA_VERSION 테스트는 마커가
  // 아예 없는 이 케이스를 걸러내지 못했으므로, java-version 줄 자체를 스캔한다.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      if (/java-version:\s*['"0-9]/.test(line) && !/\$\{\{\s*env\.JAVA_VERSION\s*\}\}/.test(line)) {
        bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [], `java-version이 리터럴로 하드코딩돼 있습니다 (@wizard ask:@jdk 마커로 교체 필요):\n  ${bad.join("\n  ")}`);
});
```

- [ ] **Step 2: 테스트 실행 후 실패(RED) 확인**

Run: `node --test tests/node/payload-example-values.test.js`

Expected: 새로 추가한 `"spring 워크플로우는 java-version을 리터럴로 하드코딩하지 않는다"` 테스트가 FAIL. 에러 메시지에 아래 2줄이 포함되어야 한다:

```
spring/nexus/PROJECT-SPRING-NEXUS-CI.yml:41  java-version: '17'
spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml:28  java-version: '17'
```

(정확한 줄 번호는 파일 원본과 동일해야 함 — CI는 41번째 줄, PUBLISH는 28번째 줄)

다른 기존 테스트들은 여전히 전부 PASS여야 한다 (총 5개 테스트 중 1개만 FAIL).

- [ ] **Step 3: 커밋**

```bash
git add tests/node/payload-example-values.test.js
git commit -m "test: spring 워크플로우 java-version 하드코딩 검출 테스트 추가

이슈 #82 — NEXUS-CI/NEXUS-PUBLISH가 @wizard 마커 없이 java-version을
리터럴로 하드코딩하고 있어, 기존 마커 기반 테스트가 놓치던 사각지대를
검출하는 테스트를 추가한다. 아직 마커 자체는 붙이지 않아 RED 상태."
```

---

### Task 2: `PROJECT-SPRING-NEXUS-CI.yml` JAVA_VERSION 마커화 (GREEN, 절반)

**Files:**
- Modify: `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`

**Interfaces:**
- Consumes: `@wizard ask:@jdk` 마커 문법 (payload 템플릿 전역 관례, `src/core/wizard-env.js`의 `parseWizardLine`이 파싱), `@jdk` 리졸버 (`src/core/detect-fs.js:126`, 이미 존재·수정 없음)
- Produces: 없음 (payload 템플릿 파일 자체가 산출물)

- [ ] **Step 1: `env:` 블록 신설**

`payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`에서 아래(기존 `permissions` 블록 바로 뒤, `jobs:` 바로 앞 — 참조 패턴인 `GITHUB-PACKAGES-PUBLISH.yml`과 동일하게 `permissions` 다음에 `env`를 둔다):

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  checks: write

jobs:
```

를 아래로 교체:

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
  checks: write

env:
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:@jdk

jobs:
```

- [ ] **Step 2: `Setup JDK` 스텝의 하드코딩 제거**

같은 파일에서 아래(38-42번째 줄 부근):

```yaml
    - name: Setup JDK 17
      uses: actions/setup-java@v5
      with:
        java-version: '17'
        distribution: 'temurin'
```

를 아래로 교체 (스텝 이름에서도 이제 고정값이 아니므로 `17` 제거 — `GITHUB-PACKAGES-PUBLISH.yml`의 `Set up JDK` 표기와 동일선상):

```yaml
    - name: Setup JDK
      uses: actions/setup-java@v5
      with:
        java-version: ${{ env.JAVA_VERSION }}
        distribution: 'temurin'
```

- [ ] **Step 3: 관련 테스트만 실행해 부분 확인**

Run: `node --test tests/node/payload-example-values.test.js`

Expected: `"spring 워크플로우는 java-version을 리터럴로 하드코딩하지 않는다"` 테스트가 여전히 FAIL하지만, 에러 메시지에는 `PROJECT-SPRING-NEXUS-PUBLISH.yml:28` 한 줄만 남아야 한다 (`NEXUS-CI.yml` 항목은 사라짐). 이 단계에서 완전 GREEN이 아닌 것은 정상 — Task 3에서 마저 고친다.

다른 4개 기존 테스트는 계속 PASS.

- [ ] **Step 4: 커밋**

```bash
git add payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml
git commit -m "fix: NEXUS-CI 워크플로우 JAVA_VERSION을 @wizard 마커로 교체

이슈 #82 — java-version: '17' 하드코딩을 GITHUB-PACKAGES-PUBLISH.yml과
동일한 패턴(env.JAVA_VERSION + @wizard ask:@jdk)으로 교체한다.
프로젝트 툴체인 실측값을 기본값으로 제시하고, 감지 실패 시 21로 폴백된다."
```

---

### Task 3: `PROJECT-SPRING-NEXUS-PUBLISH.yml` JAVA_VERSION 마커화 + permissions/concurrency 보강 (GREEN)

**Files:**
- Modify: `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml`

**Interfaces:**
- Consumes: `@wizard ask:@jdk` 마커 문법, `@jdk` 리졸버 (Task 2와 동일, 수정 없음)
- Produces: 없음

- [ ] **Step 1: `permissions`/`concurrency` 블록 추가 + `env:` 블록 신설**

`payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml`에서 아래:

```yaml
name: PROJECT-SPRING-NEXUS-PUBLISH

on:
  push:
    branches: ["{{MAIN_BRANCH}}"]
    tags:
      - 'v*.*.*'

jobs:
```

를 아래로 교체 (`GITHUB-PACKAGES-PUBLISH.yml`과 동일 구조 — `permissions`는 GitHub Packages에 쓰지 않으므로 `contents: read`만 최소 권한으로 부여, `concurrency`는 동시 배포 경쟁 방지):

```yaml
name: PROJECT-SPRING-NEXUS-PUBLISH

on:
  push:
    branches: ["{{MAIN_BRANCH}}"]
    tags:
      - 'v*.*.*'

concurrency:
  group: nexus-publish-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

env:
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:@jdk

jobs:
```

- [ ] **Step 2: `Set up JDK` 스텝의 하드코딩 제거**

같은 파일에서 아래(원본 25-29번째 줄 부근, Step 1 반영 후에는 줄 번호가 밀려 있음 — `Set up JDK 17` 텍스트로 찾을 것):

```yaml
      - name: Set up JDK 17
        uses: actions/setup-java@v5
        with:
          java-version: '17'
          distribution: 'temurin'
```

를 아래로 교체:

```yaml
      - name: Set up JDK
        uses: actions/setup-java@v5
        with:
          java-version: ${{ env.JAVA_VERSION }}
          distribution: 'temurin'
```

- [ ] **Step 3: 전체 회귀 테스트로 GREEN 확인**

Run: `node --test tests/node/payload-example-values.test.js`

Expected: 5개 테스트 전부 PASS (Task 1에서 추가한 테스트 포함).

이어서 전체 스위트 실행:

Run: `npm test`

Expected: node 465+1(신규)=466개, python 130개 전부 PASS, 실패 0.

- [ ] **Step 4: 커밋**

```bash
git add payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml
git commit -m "fix: NEXUS-PUBLISH 워크플로우 JAVA_VERSION을 @wizard 마커로 교체

이슈 #82 — java-version: '17' 하드코딩을 @wizard ask:@jdk로 교체.
동시 배포 경쟁 방지를 위한 concurrency 그룹과 GITHUB_TOKEN 최소 권한
원칙에 따른 permissions: contents: read를 함께 추가해
GITHUB-PACKAGES-PUBLISH.yml과 구조를 통일한다."
```

---

### Task 4: 최종 확인 — 이슈 #82 잔여 항목 전수 재검증

**Files:**
- 없음 (검증 전용 태스크, 파일 수정 없음)

**Interfaces:**
- Consumes: Task 1~3의 결과물 (수정된 payload 2개 파일 + 회귀 테스트)
- Produces: 없음

- [ ] **Step 1: 이슈 #82가 나열한 모든 파일에 예시값이 남아 있지 않은지 grep으로 전수 확인**

```bash
grep -rn "java-version: '17'" payload/workflows/spring/ || echo "OK: 하드코딩된 java-version 없음"
grep -rln "my-project\|example\.conf\|/volume1/project/\|프로젝트명\|suhsaechan\.kr\|Suh-Web/" payload/workflows/ || echo "OK: 예시값 잔존 없음"
```

Expected: 두 명령 모두 "OK" 메시지만 출력 (grep이 매치를 찾지 못해 exit 1 → `||`로 OK 출력).

- [ ] **Step 2: 전체 테스트 스위트 최종 실행**

Run: `npm test`

Expected: 실패 0, node 466개 + python 130개 전부 PASS.

- [ ] **Step 3: 별도 커밋 없음**

이 태스크는 검증 전용이라 커밋할 변경사항이 없다. 모든 확인이 끝나면 태스크 완료로 표시한다.
