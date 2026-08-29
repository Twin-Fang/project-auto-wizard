# 설치 로그 시스템 전면 재설계

작성일: 2026-08-26 · 대상 버전: v0.8.2

## 배경

`.github/.wizard/logs/*.md`로 남기는 현재 구조는 이름이 "로그"지만 실제로는 **설치 결과 스냅샷 1건**이다. 실행 흐름도, 판단 근거도, 실패도 남지 않아 원인 추적에 쓸 수 없다.

### 확인된 결함

1. **죽은 코드** — `install-log.js:137-138`이 `result.skippedFiles` / `result.backupFiles`를 렌더링하지만, 두 필드는 코드베이스 어디에서도 생성되지 않는다. `full.js:117-120`이 넘기는 것은 `copiedFiles`와 `gitignoreUpdated`뿐이라 두 섹션은 영구히 출력되지 않는다.
2. **수집된 데이터 폐기** — `copy/workflows.js:143-147`이 `autoUpdated` / `keptLocal` / `removedKept` / `restoredFiles`를 수집하지만 로그로 전달되지 않는다. 업데이트에서 가장 중요한 "내 수정본이 유지됐나 덮였나"가 기록되지 않는다.
3. **판단 사유 부재** — `classify()`가 파일을 `unchanged` / `localOnly` / `newFiles` / `upstreamOnly` / `changed` 버킷으로 나누지만 그 판정이 버려진다.
4. **실패 무기록** — `writeInstallLog()`가 예외를 통째로 삼켜(`catch { return null }`) 로그 기록 실패 자체가 어디에도 남지 않는다.
5. **크래시 시 전무** — 설치가 끝난 뒤 한 번에 쓰는 구조라, 중간에 예외가 나면 아무것도 남지 않는다. 디버깅에서 가장 알고 싶은 상황에서 정보가 0이다.
6. **커버리지 부족** — 생산자가 `full.js` 하나뿐이다. uninstall · purge는 파일을 지우는 동작인데도 아무 기록을 남기지 않는다.
7. **무한 누적** — 회전·정리 정책이 없어 실행할 때마다 파일이 쌓인다.

## 결정 사항

| 항목 | 결정 | 근거 |
|---|---|---|
| 목적 | **원인 추적(디버깅)** | 결과 확인은 터미널 요약과 `--mode status`가 이미 담당 |
| 보관 | **로컬 전용** — 커밋하지 않음 | 상세도 제약을 없애고 diff 노이즈를 제거 |
| 제외 방식 | 로그 디렉토리에 **`.gitignore` 자동 생성** | 루트 `.gitignore`를 건드리지 않아 "gitignore 자동 수정은 마법사 책임 범위 밖"(이슈 #7) 원칙과 충돌하지 않음 |
| 포맷 | **`.log` 평문**, 시간순 한 줄 한 이벤트 | `bash -x` 수준의 실행 추적. grep·tail이 자연스럽고 에이전트도 컬럼으로 읽음 |
| 요약 | **`.log` 끝에 통합** | 산출물 1개. `tail`만 보면 결과, 전체를 보면 과정 |
| 수집 방식 | **모듈 수준 싱글톤 로거 + 즉시 append** | 크래시해도 직전까지 남음. 함수 시그니처 변경 없이 전 구간 계측 가능 |

### 수집 방식 대안 비교

- **A. 싱글톤 로거 (채택)** — 즉시 append로 크래시 대응. CLI는 프로세스당 1회 실행이라 전역 상태 위험이 낮다. `resetLogger()`로 테스트 격리.
- **B. 로거 주입(DI)** — 격리는 완벽하나 `detect` → `copy` → `env` → `verify` 호출 체인 전체의 시그니처를 바꿔야 해 파장이 크다.
- **C. 이벤트 수집 후 일괄 렌더** — 기존 구조와 유사하지만 크래시 시 로그가 통째로 사라져 목적과 정면으로 어긋난다.

## 설계

### 파일 수명주기

```
.github/.wizard/logs/
├── .gitignore                      # 자동 생성: "*\n!.gitignore\n"
├── 20260826-120341-install.log
├── 20260826-131502-update.log
└── 20260826-140233-uninstall.log
```

- 파일명 `YYYYMMDD-HHMMSS-<action>.log` — 파일명이 곧 정렬 키
- `action`: `install` | `update` | `uninstall` | `purge`
- **`--dry-run`은 파일 로그를 남기지 않는다** — "파일을 바꾸지 않는다"가 dry-run의 계약이고, 미리보기 출력 자체가 이미 로그와 같은 정보를 담는다
- **회전: 최근 20개 유지** — `initLogger()`가 새 파일을 열기 직전에 수행하고, 초과분은 파일명(시각) 오름차순으로 오래된 것부터 삭제
- `.gitignore`는 디렉토리 생성 시 함께 기록하며, 이미 있으면 덮어쓰지 않는다
- uninstall이 `.github/.wizard`를 통째로 지우는 현재 동작은 유지

### 로그 포맷

```
=== project-auto-wizard v0.8.2 | install | 2026-08-26 12:03:41 ===
argv    : project-auto-wizard --mode full --type spring
node    : v20.12.0 | darwin arm64 | cwd=/Users/x/demo
target  : /Users/x/demo

12:03:41.221 INFO  detect  marker      build.gradle → spring
12:03:41.230 INFO  copy    write       PROJECT-SPRING-CI.yaml (new)
12:03:41.231 INFO  copy    skip        PROJECT-COMMON-VERSION-CONTROL.yaml (unchanged)
12:03:41.232 INFO  copy    keep-local  PROJECT-SPRING-SIMPLE-CICD.yaml (업스트림 무변경, 사용자 수정본 유지)
12:03:41.240 INFO  env     subst       PROJECT-SPRING-SIMPLE-CICD.yaml:44 SERVER_HOST=1.2.3.4
12:03:41.250 WARN  verify  unresolved  PROJECT-SPRING-PR-PREVIEW.yaml:43 __APPLICATION_YML_PATH__
12:03:41.999 FAIL  copy    write       EACCES: permission denied '.github/workflows/X.yaml'

=== 요약 ===
설치       : 12개 파일
자동 갱신  : 3개 (사용자 미수정)
유지       : 2개 (사용자 수정본)
백업 교체  : 1개 (.bak 생성)
미치환     : 2건  ← 조치 필요
필요 Secret: 6개
소요       : 1.42s
결과       : OK (경고 2)
```

고정 5열 `시각 | 레벨 | scope | action | detail`. 레벨은 `INFO` / `WARN` / `FAIL` 3종.

### 로거 API — `src/core/logger.js` (신설)

```js
initLogger(targetRoot, { action, argv, templateVersion })
log.info(scope, action, detail)
log.warn(scope, action, detail)
log.fail(scope, action, detail)
log.summary(rows)      // rows: Array<[label: string, value: string]> — 좌측 라벨 정렬 후 기록
closeLogger()
resetLogger()
```

- **호출 즉시 `appendFileSync`** — 버퍼링하지 않는다
- 로거 자체가 실패하면 stderr에 한 줄 경고 후 **no-op으로 전환**. 설치는 계속된다
- `initLogger` 미호출 상태의 `log.*` 호출은 무시(no-op) — 테스트와 라이브러리 사용을 깨지 않기 위함
- 마스킹은 기존 `SECRET_KEY_RE` 규칙을 유지 — 현재 질문 항목에 비밀은 없지만 향후 추가 대비

### 계측 지점

`full.js`의 9단계를 scope로 사용한다.

| scope | 기록 대상 |
|---|---|
| `detect` | 마커 발견 근거, 타입 확정, 버전 감지 출처, 브랜치 |
| `prompt` | 질문별 응답 + 기본값 여부 |
| `copy` | **파일별 결정과 사유** — `write` / `skip` / `keep-local` / `auto-update` / `backup` / `template` / `removed-kept` / `restored` |
| `env` | 치환된 키 · 파일 · 줄번호 |
| `version` | version.yml 생성, 스택별 버전 파일 동기화 |
| `cleanup` | 이전 배포 방식 삭제 · 백업 |
| `baseline` | baseline 기록 대상 수 |
| `verify` | 미치환 토큰, 필요 Secret |

`copy` scope가 이번 재설계의 핵심이다. `classify()`의 버킷 판정을 사유와 함께 남기면 "내 수정본이 왜 안 덮였나", "이 파일은 왜 `.bak`이 생겼나"가 즉답된다.

### 생산자 확대

`full.js` 외에 `uninstall.js` · `purge.js`도 로그를 남긴다. "무엇이 지워졌는지"는 설치만큼 자주 필요한 질문이다.

`dry-run.js`는 제외한다 — 파일을 만들지 않는 것이 이 모드의 계약이다.

### 제거 대상

- `renderInstallLog()` · `writeInstallLog()` — `.md` 생성 폐지
- 죽은 필드 참조 `result.skippedFiles` · `result.backupFiles`
- `stampFrom()` · `logFilename()` · `maskValue()` · `LOG_DIR`은 `logger.js`로 이관

### 기존 `.md` 처리

`.gitignore`는 이미 추적 중인 파일에 영향이 없으므로 기존에 커밋된 `.md`는 그대로 남는다. **임의로 삭제하지 않고** 요약 화면에 안내 한 줄만 출력한다.

```
이전 버전의 설치 기록(.md)이 git에 추적 중입니다:
  git rm -r --cached .github/.wizard/logs
```

## 테스트 전략

`tests/node/verify-and-install-log.test.js`를 대체한다.

| 대상 | 검증 내용 |
|---|---|
| 로거 단위 | 라인 포맷 5열, 레벨 3종, 마스킹, `resetLogger()` 격리 |
| `.gitignore` | 디렉토리 생성 시 자동 기록, 기존 파일 미덮어씀 |
| 회전 | 21번째 실행 시 가장 오래된 파일 삭제, 20개 유지 |
| 크래시 내성 | 중간 예외 발생 시 직전까지의 라인이 파일에 남아 있음 |
| 계측 통합 | 설치 후 로그에 `detect` / `copy` / `env` / `verify` 라인이 존재 |
| 생산자 확대 | uninstall 실행 시 `-uninstall.log` 생성 |
| 로거 실패 내성 | 쓰기 불가 상황에서 설치가 성공으로 끝남 |

## 범위 밖

- 로그를 읽어 해석하는 CLI 서브커맨드 (`--mode logs` 등) — 필요해지면 별도 과제
- 원격 전송 · 텔레메트리 — 이 도구의 무의존성 원칙과 충돌
- 로그 레벨 필터링 옵션 (`--quiet` / `--verbose`) — 로컬 전용이라 항상 최대 상세로 기록
