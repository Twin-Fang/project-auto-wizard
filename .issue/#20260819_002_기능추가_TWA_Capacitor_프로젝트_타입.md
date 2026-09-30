<!-- GitHub Issue: #91 | https://github.com/Twin-Fang/project-auto-wizard/issues/91 -->
⚙️[기능추가][앱] Android TWA / Capacitor 프로젝트 타입 지원 추가

### 어떤 문제를 해결하고 싶으신가요?

지금 `version.yml` 주석 기준 지원되는 `project_types`는 `spring, flutter, next, react, react-native, react-native-expo, node, python, basic`뿐입니다(`payload/workflows/` 아래도 `common, flutter, next, python, react, spring` 디렉토리만 존재). 웹 프로젝트(React/Vite 등)를 그대로 **안드로이드 TWA(Trusted Web Activity)로 APK 패키징**하거나 **Capacitor로 하이브리드 네이티브 앱화**해서 스토어에 올리는 시나리오는 지금 project-auto-wizard로 커버되지 않습니다.

개인적으로 운영 중인 `chuseok22-github-template` 저장소에는 이 두 시나리오용 워크플로우(`android-twa-build.yml`, `capacitor-app-build.yml`, `capacitor-app-upload.yml` — iOS TestFlight/Play 콘솔 내부테스트 업로드까지 포함)가 이미 있어, 이걸 project-auto-wizard의 project_type 체계로 이식하려고 합니다.

### 제안하는 해결 방법

TWA와 Capacitor 둘 다 "웹앱을 감싸서 네이티브/하이브리드로 배포"하는 성격이라, 다음 두 축이 함께 필요합니다:

- **웹앱 기반**: React/Vite로 만들어진 기존 웹 프로젝트(project_type `react`)를 빌드 소스로 사용
- **네이티브 앱 기반**: 그 빌드 산출물을 감싸는 Android(TWA)/iOS·Android(Capacitor) 네이티브 프로젝트 골격과 서명·업로드 설정

새 project_type을 `twa`, `capacitor`(또는 유사 명칭)로 추가하고, 기존 `react`/`next` 웹앱 타입과 함께 선택되는 **모노레포형 멀티타입**(`project_types: [react, twa]`처럼) 구조로 설계하는 것을 제안합니다 — `version.yml` 헤더 주석에 이미 "Multi-type projects: list every type in the project_types array"라고 이 패턴이 정의돼 있어 자연스럽게 맞습니다.

### 고려한 다른 방법(선택)

`flutter`처럼 완전히 독립된 project_type으로만 둘 수도 있지만, TWA/Capacitor는 네이티브에서 새로 그리는 게 아니라 **기존 웹 프로젝트를 감싸는** 구조라 웹 타입과의 조합(멀티타입) 없이는 실제로 쓸모가 없어 보입니다. 다만 정확한 설계(멀티타입 vs 독립 타입, 디렉토리 구조)는 구현 착수 시 더 검토가 필요합니다.
