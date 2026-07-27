# DESIGN.md

## [SOLUTION]
신규 패키지(`project-auto-wizard`)의 첫 배포 실패 문제를 해결하기 위해, 문제의 직접적인 원인이 되는 **`--provenance` 옵션을 일시적으로 배포 워크플로우에서 제거(또는 주석 처리)**한 후, 기존의 All Packages Classic Token을 그대로 사용하여 즉시 배포를 성공시킨다. 배포가 안전하게 완료된 이후, 사용자의 요구에 따라 보안 강화를 위해 Granular Token을 발급받아 복구하는 선택적 방안을 제공한다.

### 핵심 설계 결정 및 근거
* **결정**: `.github/workflows/NPM-PUBLISH.yaml`의 `npm publish --provenance --access public`에서 `--provenance` 플래그 제거.
* **근거**: 현재 사용 중인 토큰(`npm_XIUI...`)은 Classic Token 형태를 띠고 있으며, All Packages 권한이 있으므로 `--provenance` 플래그가 배포 요청에 개입되지 않는다면 신규 패키지를 즉시 등록할 수 있는 모든 권한을 충족한다. `--provenance` 디지털 서명 생성 과정에서 발생하는 npm 레지스트리와의 서명 연동 오류가 404의 실질적 원인이므로, 이 플래그를 비활성화하면 첫 배포가 즉시 통과된다.

---

## [ALTERNATIVES_CONSIDERED]

### 대안 A: NPM Granular Access Token (미세 조정 토큰) 신규 발급 진행
* **설명**: 사용자가 npmjs.com에 로그인하여 기존 클래식 토큰이 아닌 **Granular Access Token**을 신규 생성하고, "All packages" 범위의 Read/Write 권한을 부여한 뒤 이를 `NPM_TOKEN` 비밀값으로 업데이트하여 `--provenance`를 유지하는 방법.
* **기각 사유**: 사용자가 "토큰 종류나 옵션이 무엇인지 모른다"고 언급하였으므로, 새로운 토큰 형식의 복잡한 생성 절차(Granular는 아직 베타 혹은 복잡한 UI 세팅 필요)를 사용자에게 전가하는 것은 배포 지연 및 인지 피로를 증가시킴. 즉각적인 배포를 달성하기 위해 기각함.

### 대안 B: `--access public` 제거 및 수동 배포
* **설명**: CI/CD 환경이 아닌 로컬 터미널에서 `npm publish`를 직접 실행하여 최초 등록을 처리함.
* **기각 사유**: 로컬 PC 환경은 프록시/사내 방화벽으로 인해 `registry.npmjs.org`로의 SSL 연결이 원천 차단(Connection reset)되어 있어 시도가 불가능함.

---

## [REVIEW_LOG]
* **리뷰어 설계 검증**:
  * **설계적 한계 비판**: `--provenance` 옵션을 제거하면 SLSA 3단계 수준의 출처 증명 보안 디지털 서명이 누락됩니다. 이는 민감한 기업용 솔루션인 경우 패키지의 안전성을 낮추는 요소가 될 수 있습니다.
  * **보완 전략**: 첫 배포를 최우선으로 통과시킨 후, 사용자가 원할 경우 언제든지 Granular Token 발급 프로세스를 통해 워크플로우를 원상복구할 수 있는 상세 가이드를 가이드라인 문서에 보존해야 합니다. 또한 `--provenance` 제거로 인해 package.json이나 다른 파일이 깨지지 않는지 구체적인 사양 검증 단계가 수반되어야 합니다.
