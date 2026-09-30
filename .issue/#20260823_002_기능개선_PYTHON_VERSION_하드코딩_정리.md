<!-- GitHub Issue: #99 | https://github.com/Twin-Fang/project-auto-wizard/issues/99 -->
🚀[기능개선][python] PYTHON_VERSION 하드코딩 및 미사용 정리

### 어떤 문제를 해결하고 싶으신가요?

`payload/workflows/python/PROJECT-PYTHON-CI.yaml:34`와 `payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml:74`에 각각 `PYTHON_VERSION: "3.13"`이 고정값으로 선언되어 있습니다. 두 파일을 모두 확인해보면 이 값은 선언된 줄 외에는 어디에서도(`${{ env.PYTHON_VERSION }}` 형태로) 참조되지 않습니다 — 두 워크플로우 모두 `actions/setup-python` 스텝 자체가 없고, CI는 순수 `docker build` 검증만 수행하기 때문입니다(실제 파이썬 버전은 프로젝트의 Dockerfile이 결정).

즉 이 값은 프로젝트가 실제로 3.11이나 3.12를 쓰더라도 항상 "3.13"으로 표시되는 하드코딩인 동시에, 어디에도 쓰이지 않는 죽은 선언입니다.

같은 저장소 안에 이미 비교 가능한 정상 패턴이 있습니다 — Spring/Flutter 워크플로우의 `JAVA_VERSION`은 `"__JAVA_VERSION__"  # @wizard ask:17` (또는 `@wizard ask:@jdk`) 형태로 설치 시점에 동적 주입되고, `payload/config/wizard-prompts.yml`에도 등록되어 있으며, `java-version: ${{ env.JAVA_VERSION }}`으로 `actions/setup-java`에 실제로 소비됩니다. `PYTHON_VERSION`은 `wizard-prompts.yml`에 항목 자체가 없습니다.

### 제안하는 해결 방법

두 개의 별도 문제로 나눠서 접근하는 것을 제안합니다.

- **미사용 문제**: 지금 이 두 워크플로우에서 `PYTHON_VERSION`을 실제로 참조하는 스텝이 없다는 걸 재확인한 뒤, 정말 아무 데도 안 쓰인다면 죽은 선언을 제거하는 쪽이 단순합니다.
- **하드코딩 문제**: 만약 향후 `actions/setup-python` 스텝(예: 빌드 전 린트·테스트 등)을 추가할 계획이 있다면, 그때는 `JAVA_VERSION`과 동일한 패턴 — `__PYTHON_VERSION__` 플레이스홀더 + `@wizard ask` 주석 + `payload/config/wizard-prompts.yml` 등록 — 으로 동적화하는 것이 기존 관례와 일치합니다.

### 고려한 다른 방법(선택)

현재 상태를 그대로 두는 방법도 있습니다. 어차피 안 쓰이는 값이라 동작에는 영향이 없지만, 워크플로우 주석/env를 읽는 사용자에게 실제 파이썬 버전과 다른 값을 보여줘 오해를 줄 수 있다는 점에서 정리 가치는 있어 보입니다.
