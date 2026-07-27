# REQUIREMENT.md

## [PROBLEM]
`project-auto-wizard` 패키지를 npm 공식 레지스트리에 최초로 배포(publish)하고자 할 때, GitHub Actions `NPM-PUBLISH` 워크플로우에서 `npm publish` 수행 중 `404 Not Found - PUT https://registry.npmjs.org/project-auto-wizard` 에러가 발생하며 배포가 실패함.

## [REQUIREMENT]
1. `project-auto-wizard` v0.1.2 버전을 npm 공식 레지스트리(`https://registry.npmjs.org`)에 성공적으로 최초 배포한다.
2. 향후 신규 버전 추가 배포 시에도 멱등성이 보장되고 실패 없이 자동 배포가 완료되는 배포 파이프라인 및 자격 증명(Token) 설정을 완전히 확립한다.
3. 배포 성공 여부를 정량적으로 검증한다.

## [ASSUMPTIONS]
1. 사용자가 제공한 토큰 `npm_XIUI...`은 실제 npm 계정(`Twin-Fang`)의 유효한 쓰기 권한을 지닌 토큰이다.
2. `project-auto-wizard`라는 패키지 명칭은 현재 npm 레지스트리에 타인에 의해 등록되지 않은 고유한 이름이다.
3. 보안 강화 및 신뢰성 확보를 위해 배포 워크플로우 내 `--provenance` 옵션을 유지한 채 배포해야 한다.

## [AMBIGUITY]
1. **토큰 종류의 모호성**: 제공된 토큰(`npm_XIUI...`)이 Granular Access Token인지 Classic Token인지 모호함. Classic Token은 npm 정책상 `--provenance` 배포를 지원하지 않거나 신규 패키지 퍼블리시 시 404 오류를 유발할 수 있음.
2. **패키지명 선점 상태**: `project-auto-wizard`가 실제 레지스트리 상에서 사용 가능한 이름인지(타인의 선점 여부) 로컬 방화벽 외부 환경(GitHub Actions 등)을 통해 확정 검증되지 않음.

## [REVIEW_LOG]
* **리뷰어 비판 분석**:
  * **엣지 케이스 1**: 토큰 권한이 "All packages"로 지정되어 있더라도, **Classic Token**인 경우 `--provenance` 옵션이 적용된 신규 패키지 배포 시 서명 검증 인프라 연동 문제로 404 Not Found가 응답될 수 있습니다. 이 경우 워크플로우에서 `--provenance`를 임시로 제거하여 배포를 수행하거나, 완전히 재생성된 **Granular Access Token**을 사용하도록 설계를 분기해야 합니다.
  * **엣지 케이스 2**: 패키지명이 이미 다른 사용자에 의해 등록된 상태라면, 배포 권한이 없으므로 영구적으로 404/403 오류가 발생합니다. 배포 설계에 앞서 실제 npmjs API를 통해 해당 패키지명의 선점 여부를 확인하는 독립된 사전 검증 단계가 필수적입니다.
