# 보안 정책

## 지원 버전

가장 최신 릴리스 버전만 보안 패치 지원 대상입니다(`npm view project-auto-wizard version` 참고).

## 취약점 신고 방법

**공개 이슈로 등록하지 마세요.** project-auto-wizard 또는 이 도구가 생성하는 GitHub Actions 워크플로우에서 보안 취약점(예: 시크릿 유출 경로, 명령 주입, 권한 상승)을 발견하면 GitHub의 [비공개 보안 권고(Private Security Advisory)](https://github.com/Twin-Fang/project-auto-wizard/security/advisories/new) 기능으로 신고해 주세요.

## 응답 기준

- 신고 접수 후 최대한 빠르게 확인하고, 심각도에 따라 우선순위를 정해 대응합니다.
- 수정이 완료되면 CHANGELOG와 GitHub Release Notes에 보안 수정 사항을 명시합니다(신고자가 원치 않으면 익명 처리).

## 설계상 보안 원칙

- 설치 자산(워크플로우·스크립트·설정)은 전부 npm 패키지에 동봉된 `payload/`에서 나옵니다. 설치 중 원격 코드나 데이터를 내려받지 않으므로, 같은 패키지 버전이면 설치 결과가 같습니다.
- 마법사가 읽고 쓰는 곳은 `payload/`와 실행한 레포 폴더(`.github/`, `version.yml`, `README.md`, `.gitignore` 등)뿐입니다.
- 마법사 자체는 네트워크 요청을 하지 않습니다. 네트워크가 쓰이는 경우는 아래 git/gh 명령뿐이며, 모두 사용자의 레포와 사용자의 인증 정보로 실행됩니다.
  - 기본 브랜치 감지: `git remote show origin` (로컬에 `origin/HEAD`가 없을 때)
  - 원격에 develop 브랜치가 없을 때 생성: `git push -u origin <develop>` (대화형은 확인 후, `--force`는 자동)
  - `--mode doctor`: `gh auth status`, `gh api`, `gh secret list`로 저장소 설정을 조회 (읽기 전용)
- 설치된 워크플로우는 기본적으로 `GITHUB_TOKEN`만으로 동작합니다. AI 요약은 기본으로 꺼져 있고, 켜면 GitHub Copilot CLI가 `GITHUB_TOKEN`(`copilot-requests: write`)으로 동작합니다. 그 밖의 시크릿(`AI_API_KEY`, `WORKFLOW_PAT`, 배포·서명 시크릿 등)은 사용자가 직접 등록한 것만 사용합니다.
