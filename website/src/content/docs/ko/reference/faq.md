---
title: FAQ
description: 자주 묻는 질문과 문제 해결.
---

## API 키가 필요한가요?

아니요. 릴리스 노트는 기본적으로 규칙 기반입니다. Copilot은 Actions의 `GITHUB_TOKEN`을 쓰고, 사용자 지정 AI API는 선택입니다. [요약 엔진](../../understand/summary-engine/)을 참고하세요.

## `WORKFLOW_PAT`이 필요한가요?

아니요. 없어도 `GITHUB_TOKEN` 폴백이 automerge, 태그, Release, 릴리스 브랜치 배포까지 이어받습니다(최대 ~20초 추가). 다른 워크플로우가 `release: published` 이벤트로 돌아야 할 때(예: npm 배포)만 필요합니다. `GITHUB_TOKEN`으로 만든 이벤트는 다른 워크플로우를 트리거하지 않기 때문입니다. 조직 bot/machine 계정으로 발급하세요 (scopes: `repo`, `workflow`).

## 릴리스 PR이 automerge되지 않습니다.

레포 설정에서 merge commit이 허용되어 있는지 확인하세요. `npx project-auto-wizard --mode doctor`가 이 항목을 점검합니다. PR이 `version.yml`에 설정된 개발 브랜치에서 릴리스 브랜치로 가는지도 확인하세요.

## Workflow permissions를 "Read and write"로 올려야 하나요?

설치된 워크플로우 때문이라면 아닙니다. 각자 `permissions`를 선언합니다. 직접 추가한 워크플로우가 `permissions` 없이 쓰기 작업을 할 때만 올리세요.

## 배포 워크플로우가 체크아웃 직후 실패합니다.

배포·프리뷰 워크플로우는 필수 Secret과 `Dockerfile`을 먼저 점검하고, 빠진 것의 이름을 오류로 알려 줍니다. Settings → Secrets and variables → Actions에 등록하세요. 서버에 배포하지 않는 프로젝트라면 배포 워크플로우를 지우거나 `--deploy-style none`으로 다시 설치하세요.

## 브랜치 보호 규칙에 어떤 check를 등록해야 하나요?

**`CI Gate`**(`ci-gate`) 하나만 등록하세요. CI 워크플로우는 항상 실행되고 프로젝트 경로가 바뀌지 않았으면 내부에서 job을 건너뜁니다. 개별 job을 필수로 걸거나 워크플로우 단위 `paths` 필터에 기대면 check가 Pending에 머물러 머지가 막힐 수 있습니다.

## 커밋이 Conventional Commits를 따르지 않습니다.

괜찮습니다. 분류되지 않은 커밋은 patch로 봅니다. 요약은 무형식 bullet 목록으로 폴백합니다. 사용자 지정 AI나 Copilot이 설정되어 있으면 patch를 minor로 올릴 수는 있지만 major로는 올리지 않습니다.

## minor나 major 릴리스를 강제하려면?

minor는 `feat:`, major는 `!`(`feat!:`)나 `BREAKING CHANGE:` 푸터를 쓰세요. `semver_auto: false`라면 `version.yml`에서 major/minor를 직접 고칩니다. 워크플로우는 patch만 올립니다.

## 설치된 워크플로우를 고쳤습니다. 업데이트하면 덮어쓰나요?

아니요. payload가 그 파일을 바꾸지 않았다면 수정본을 유지합니다. 양쪽 다 바뀌었으면 유지, `.bak` 백업 후 교체, 참고본 추가 중에서 고릅니다. `--force`면 유지합니다. [업데이트](../../operate/updating/)를 참고하세요.

## `--mode status`가 손대지 않은 파일을 수정했다고 합니다.

질문(예: 배포 포트)에 기본값이 아닌 값으로 답했다면 파일이 기본 템플릿과 달라 수정된 것으로 표시됩니다. [status](../../operate/status/#드리프트-판정-기준)를 참고하세요.

## 마법사가 어딘가로 데이터를 보내나요?

마법사 자체는 네트워크 요청을 하지 않습니다. 사용자 레포를 대상으로 한 git/gh 명령만 원격에 접속합니다: 기본 브랜치 감지, 새 개발 브랜치 push, `--mode doctor`의 `gh api` 호출. Copilot이나 사용자 지정 AI API를 켜면 워크플로우가 PR 제목, 커밋 제목, `git diff --stat`을 해당 서비스로 보냅니다.

## npm, PyPI, 앱스토어에 배포하나요?

패키지는 배포하지 않습니다. 태그와 GitHub Release에서 끝나므로, 배포하려면 Release 이벤트에 워크플로우를 추가하세요. Flutter 스토어 업로드(Play Store, TestFlight)는 Flutter용으로 설치되는 별도 워크플로우입니다.

## GitHub가 아닌 곳에서도 쓸 수 있나요?

아니요. 설치되는 것은 전부 GitHub Actions입니다.
