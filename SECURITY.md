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
