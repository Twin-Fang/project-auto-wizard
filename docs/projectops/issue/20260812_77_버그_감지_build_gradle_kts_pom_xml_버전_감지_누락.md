### 무슨 일이 있었나요?

Spring 프로젝트(Kotlin DSL, `build.gradle.kts`)에 대화형으로 설치했더니 버전을 자동 감지하지 못하고 기본값 `0.0.1`로 `version.yml`이 생성됐습니다.

```
⚠️  버전을 자동 감지하지 못해 기본값 0.0.1을 사용합니다 — --project-version으로 직접 지정하거나 version.yml을 확인하세요.
┌  🔍 프로젝트를 살펴보는 중...
│  ✓ build.gradle 발견 → spring 감지
│  ✓ 버전: v0.0.1 · 브랜치: main
```

코드를 확인한 결과 원인이 두 갈래로 나뉩니다.

**① 버전 감지가 `build.gradle` 한 파일만 읽습니다** (`src/core/detect.js` 의 `detectVersionFromFiles`)

- 타입 감지(`detectTypesFromMarkers`)는 `build.gradle`, `build.gradle.kts`, `pom.xml` 세 가지를 모두 spring 마커로 인정합니다.
- 그런데 버전 감지 쪽은 `build.gradle` 만 읽습니다. 즉 **Kotlin DSL(`build.gradle.kts`) 프로젝트와 Maven(`pom.xml`) 프로젝트는 구조적으로 버전 감지가 100% 실패**합니다.
- `version.yml` 템플릿 주석에는 "spring: build.gradle / build.gradle.kts" 라고 두 파일이 모두 동기화 대상으로 적혀 있어, 설치 시점 감지만 규약에서 빠져 있는 상태입니다.

재현 확인: `build.gradle.kts` 하나만 두고 버전 감지 함수를 직접 호출하면, 파일 안에 정상적인 `version = "1.4.2"` 가 있어도 결과가 `0.0.1` 로 떨어지고 경고가 출력됩니다.

**② 감지 로그가 실제로 발견한 파일명과 다른 이름을 출력합니다** (`src/core/detect.js` 의 `markerForType`, `src/ui/status-cards.js` 의 `printDetectionLog`)

- `markerForType('spring')` 은 실제 감지에 쓰인 파일과 무관하게 항상 `build.gradle` 을 돌려줍니다.
- 그래서 같은 설치 로그 안에서 `build.gradle 발견 → spring 감지` 라고 찍은 뒤, 몇 줄 아래 경로 확정 단계에서는 `spring → build.gradle.kts` 라고 다른 파일을 보여줍니다.
- 사용자 입장에서는 "어느 파일을 본 거지?" 라는 혼선이 생기고, ①번 버그를 추적할 때도 잘못된 단서를 줍니다.

동일한 불일치가 python(`setup.py`, `requirements.txt` 만 있어도 `pyproject.toml` 이라고 출력), spring의 `pom.xml` 케이스에도 있습니다.

### 기대했던 동작

- `build.gradle.kts` / `pom.xml` 만 있는 프로젝트에서도 실제 버전을 읽어 `version.yml` 에 반영되어야 합니다.
- 감지 로그에 출력되는 마커 파일명은 **실제로 존재를 확인한 파일**이어야 합니다. 감지 로그와 경로 확정 화면이 서로 다른 파일명을 말하면 안 됩니다.
- 버전을 정말 못 찾은 경우에만 `0.0.1` 폴백 경고가 떠야 합니다.

### 실행한 명령어

```
npx project-auto-wizard@latest
```
(대화형, 전체 설치 모드)

### project-auto-wizard 버전

v0.2.0

### OS

macOS
