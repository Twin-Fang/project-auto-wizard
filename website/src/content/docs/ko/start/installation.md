---
title: 설치와 요구사항
description: 요구사항, 타입 감지, 멀티타입, 모노레포 경로, 질문 문구 커스터마이징.
---

## 요구사항

| 위치 | 요구사항 |
|---|---|
| 내 컴퓨터 | Node.js **20.12 이상** (`npx`로 실행하며 npm 의존성이 없습니다). 브랜치 감지에 `git`. `gh`는 `--mode doctor`에서만 사용합니다. |
| 레포 | GitHub에 있는 git 레포. 레포 루트에서 실행합니다. |
| GitHub Actions | 설치되는 스크립트는 표준 라이브러리 Python이라 GitHub 호스티드 러너에서 추가 설정 없이 동작합니다. 릴리스 PR automerge를 위해 merge commit 허용이 필요합니다. |

전역 설치는 필요 없습니다:

```bash
npx project-auto-wizard
```

## 프로젝트 타입 감지

마법사는 마커 파일을 찾아 감지한 타입을 제안합니다. 질문 화면에서 그대로 쓰거나 바꿀 수 있고, `--type`을 주면 감지를 건너뜁니다.

| 타입 | 감지 기준 |
|---|---|
| `flutter` | `pubspec.yaml` |
| `spring` | `build.gradle`, `build.gradle.kts`, `pom.xml` |
| `python` | `pyproject.toml`, `setup.py`, `requirements.txt` |
| `go` | `go.mod` |
| `react-native-expo` | `expo` 의존성이 있는 `package.json` |
| `react-native` | `react-native` 의존성이 있는 `package.json` |
| `react` | `react` 또는 `next` 의존성이 있는 `package.json` (Next.js 프로젝트도 React 타입) |
| `node` | 위 의존성이 없는 `package.json`, 다른 타입이 없을 때 |
| `basic` | 위에 해당하는 것이 없을 때 |

`package.json`은 본문 문자열이 아니라 의존성 키(`dependencies`, `devDependencies`, `peerDependencies`)로 분류하므로, keywords의 `next`나 `export` 스크립트 때문에 오감지되지 않습니다.

### 초기 버전

`--project-version`을 주지 않으면 주 타입의 파일(`build.gradle`/`build.gradle.kts`/`pom.xml`, `pubspec.yaml`, `pyproject.toml`/`setup.py`, `package.json`, Expo는 `app.json`)을 먼저 읽고, 그다음 다른 파일, 마지막으로 최신 git 태그를 봅니다. `-rc.1` 같은 prerelease 접미사는 버립니다. 아무것도 찾지 못하면 `0.0.1`을 쓰고 경고를 출력합니다.

## 멀티타입

```bash
npx project-auto-wizard --mode full --force --type spring,react,python
```

나열한 타입은 `version.yml`의 버전 하나를 공유합니다. 첫 번째 타입이 주 타입이며, 릴리스 때 이 타입의 버전 파일을 `version.yml`과 비교합니다.

## 모노레포 경로

타입이 하위 폴더에 있으면 `--paths`로 지정합니다:

```bash
npx project-auto-wizard --mode full --force --type flutter,react --paths "flutter=app,react=client"
```

매핑은 `version.yml`의 `project_paths`에 저장됩니다. 워크플로우는 그 폴더를 기준으로 동작하고, 릴리스 브랜치 push로 도는 배포 워크플로우는 해당 폴더가 바뀔 때만 실행됩니다.

## 질문 문구 커스터마이징

마법사가 묻는 질문의 라벨·도움말·예시 문구는 `.github/config/wizard-prompts.yml`로 재정의할 수 있습니다. 설치되지 않는 파일이라 직접 만들어야 합니다. 특정 타입에서만 다른 문구를 쓰려면 `{type}.KEY` 형태로 오버라이드합니다.

```yaml
PROJECT_NAME:
  label: "프로젝트 이름이 뭔가요?"
  help: "GitHub 레포 이름과 다르게 표시하고 싶을 때만 입력하세요."

flutter.APP_ARTIFACT_NAME:
  label: "Flutter 앱 아티팩트 이름"
```

## 파일을 쓰지 않고 미리보기

`--dry-run`은 `full`, `uninstall`과 함께 씁니다. 무엇이 바뀔지만 보여 주고 파일을 쓰지 않으므로 `--force` 없이도 실행됩니다:

```bash
npx project-auto-wizard --mode full --force --type node --dry-run
```
