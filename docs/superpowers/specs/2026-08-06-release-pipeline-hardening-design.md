# 릴리스 파이프라인 정비 설계

**작성일**: 2026-08-06
**관련 이슈**: [#33](https://github.com/Twin-Fang/project-auto-wizard/issues/33) · [#34](https://github.com/Twin-Fang/project-auto-wizard/issues/34) · [#35](https://github.com/Twin-Fang/project-auto-wizard/issues/35) · [#36](https://github.com/Twin-Fang/project-auto-wizard/issues/36)

## 1. 배경

v0.1.18을 실제 외부 프로젝트(`EarLocAlert`)에 설치해 보는 과정에서 진단 출력의 가독성 문제가 드러났고([#29](https://github.com/Twin-Fang/project-auto-wizard/issues/29)·[#31](https://github.com/Twin-Fang/project-auto-wizard/issues/31)에서 해결), 그 수정본을 배포하는 과정에서 **배포 파이프라인 자체의 구조적 결함 3건과 진단 로직의 오진 1건**이 추가로 발견됐다.

이 문서는 그 4건을 하나의 목표 아래 정리한다 — **"릴리스가 재현 가능하고, 검증된 것만 배포되며, 진단이 사실만 말하게 한다."**

## 2. 현황 진단

### 2.1 테스트가 검증 장치로 기능하지 않는다 (#33)

`.github/workflows/` 전체에 `npm test`를 실행하는 워크플로우가 없다. PR 체크에는 `Post AI summary comment`와 `Version confirm + changelog + automerge` 둘뿐이고, `NPM-PUBLISH`도 테스트 없이 배포한다. **테스트 327개가 작성자 로컬에서만 돈다.**

로컬 실행조차 신뢰할 수 없다. 실측:

```
npm run test:node                      → 306 pass /  4 fail  (17초)
node --test --test-concurrency=1 ...   → 327 pass /  0 fail  (46초)
```

실패로 보이던 것의 정체는 `Unable to deserialize cloned data due to invalid or unsupported version` — Node 테스트 러너가 자식 프로세스의 결과를 역직렬화하지 못한 것이다. **실패가 아니라 결과 유실**이며, 병렬 실행에서는 매번 다른 3~5개 파일의 결과 **17개가 집계에서 사라진다**. 실행마다 숫자가 흔들려 "원래 좀 깨지는 것"으로 오인하기 쉽고, 실제 회귀가 섞여도 구분할 수 없다.

### 2.2 doctor가 실재하지 않는 장애를 경고한다 (#34)

레포의 `default_workflow_permissions`가 `read`이면 다음과 같이 경고한다.

```
  [!] Workflow permissions — 버전 커밋 자동 push
      ✗ 현재 read 입니다.
        워크플로가 버전 올림 커밋을 push하지 못해 릴리스가 중단됩니다.
```

이 레포 자체가 반증이다. `default_workflow_permissions`는 `read`인데 `PROJECT-VERSION-CONTROL`이 `GITHUB_TOKEN`으로 버전 커밋 push에 성공했다(run 31073413971, `version bump commit pushed`). 마법사가 설치하는 워크플로우가 전부 스스로 권한을 선언하기 때문이다.

```
PROJECT-COMMON-AUTO-CHANGELOG-CONTROL.yaml    permissions: contents: write ...
PROJECT-COMMON-README-VERSION-UPDATE.yaml     permissions: contents: write ...
PROJECT-COMMON-RELEASE-PUBLISH.yaml           permissions: contents: write ...
PROJECT-COMMON-VERSION-CONTROL.yaml           permissions: contents: write
```

레포 설정값은 **워크플로우가 `permissions:` 블록을 생략했을 때 적용되는 기본값**이지 상한이 아니다. `"릴리스가 중단됩니다"`는 사용자에게 없는 장애를 알리고 불필요한 권한 상향을 유도한다 — 최소 권한 원칙에도 역행한다.

### 2.3 npm 배포가 레이스 컨디션에 의존한다 (#35)

`main` push 하나에 워크플로우 4개가 동시에 시작한다. `NPM-PUBLISH`는 push 이벤트의 SHA가 아니라 **그 시점의 `main` 최신**을 체크아웃해 `version.yml`을 읽으므로, `VERSION-CONTROL`의 bump보다 먼저 읽으면 구버전을 보고 "이미 배포됨"으로 skip한다. bump 커밋에는 `[skip ci]`가 붙어 재트리거되지 않는다 — **한 번 지면 그 버전은 영영 배포되지 않는다.**

실측(2026-08-06):

```
PR #30 머지 (05:11:56)
  NPM-PUBLISH       05:12:07.006  version.yml → 0.1.18 → skip
  VERSION-CONTROL   05:12:08.990  0.1.19 push              ← 1.98초 늦음

PR #32 머지 (05:12:25)
  VERSION-CONTROL   ~05:12:37     0.1.20 push
  NPM-PUBLISH       05:12:43.724  version.yml → 0.1.20 → 배포 성공  ← 러너 대기로 늦게 떠서 이김
```

누락 증거 — npm에 배포된 버전 목록에서 `0.1.13`·`0.1.15`·`0.1.19`가 빠져 있다.

```
0.1.5 0.1.6 0.1.7 0.1.8 0.1.9 0.1.10 0.1.11 0.1.12 0.1.14 0.1.16 0.1.17 0.1.18 0.1.20
```

태그와 GitHub Release는 있는데 npm에는 없는 버전들이다.

### 2.4 pr-flow 정상 경로가 죽어 있다 (#36)

`origin/develop`이 `origin/main`보다 37커밋 뒤처져 있고 앞선 커밋은 0개다(PR #25 시점에서 정지). 이후 작업은 전부 feature → main 직접 머지로 진행됐다.

이것이 2.3의 **근본 원인**이기도 하다. 릴리스 PR(develop→main) 경로를 타면 `AUTO-CHANGELOG-CONTROL`이 PR 단계에서 버전을 확정하므로 `VERSION-CONTROL` 안전망이 개입하지 않고 경합도 없다. 지금은 안전망 경로로만 돌아 매 머지가 레이스다.

또한 `CONTRIBUTING.md`는 "`develop` 기준으로 브랜치를 따라"고 안내하는데, 그대로 하면 무관한 37커밋이 diff에 섞인다. 외부 기여자가 첫 PR에서 바로 막힌다.

## 3. 설계 원칙

### 3.1 도그푸딩 경계선

이 프로젝트는 **릴리스 자동화를 남의 레포에 설치해주는 도구**다. 따라서 자기 릴리스 파이프라인을 어떻게 구성하느냐가 곧 제품 시연이다. 경계선을 다음과 같이 긋는다.

| 영역 | 방식 | 근거 |
|---|---|---|
| 버전 확정 · CHANGELOG · AI 릴리스 노트 · tag · GitHub Release | **자체 구현 유지** | 이것이 제품 자체. 도그푸딩이 곧 데모다 |
| npm 배포 | **업계 표준 채택** | `NPM-PUBLISH.yaml`은 `payload/`에 없는 이 레포 전용. 제품과 무관하다 |
| CI(테스트) | **업계 표준 채택** | 마찬가지로 이 레포 전용 |

이 경계선이 유명 도구를 도입하지 않는 이유를 설명한다.

| 도구 | 채택 여부 | 이유 |
|---|---|---|
| **semantic-release** | ❌ | 전이 의존성 수백 개. `"의존성 0개"`가 이 프로젝트의 독창성 포인트라 정면 충돌 |
| **changesets** | ❌ | 동일한 의존성 문제 + 단일 패키지라 모노레포 이점이 없음 |
| **release-please** | ❌ | Action 형태라 의존성은 0이지만, **이 프로젝트가 제공하는 기능과 정확히 중복**된다. 릴리스 자동화 도구가 자기 릴리스를 남의 도구로 하면 "네 도구는 왜 네가 안 쓰냐"가 된다 |

### 3.2 릴리스 이벤트를 허브로 삼는다

`main` push에 모든 워크플로우를 매달면 서로 경쟁한다. **`release: published`를 허브로 두면** 배포처를 팬아웃으로 늘릴 수 있다 — 나중에 JSR이나 GitHub Packages를 추가할 때 워크플로우 하나만 붙이면 된다. 이것이 확장성의 핵심이다.

### 3.3 진단은 판정하지 않는다

이미 #29에서 확립한 원칙을 유지·강화한다. doctor는 "설치해도 된다/안 된다"를 판정하지 않고 발견한 사실만 진술한다. 등급(`OK`/`WARN`/`FAIL`/`INFO`)은 **사용자가 실제로 조치해야 하는가**를 기준으로 부여한다. 조치가 불필요하면 `WARN`을 쓰지 않는다.

## 4. 목표 아키텍처

```
  feature PR ──────────────────────────────┐
                                            │  ┌─ CI (신설)
  develop → main 릴리스 PR ─────────────────┼──┤  npm test
                                            │  └─ Node 20·22·24 × ubuntu·windows
                                            ▼
                        [ AUTO-CHANGELOG-CONTROL ]   ← 자체 구현 (제품)
                          버전 확정 · AI 릴리스 노트 · CHANGELOG · automerge
                                            │
                                     main push
                                            ▼
                        [ RELEASE-PUBLISH ]          ← 자체 구현 (제품)
                          git tag vX.Y.Z + GitHub Release 발행
                          ※ WORKFLOW_PAT으로 발행 → 후속 트리거 가능
                                            │
                              release: published     ← 표준 이벤트 (허브)
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                   [ NPM-PUBLISH ]   (향후) JSR      (향후) GitHub Packages
                    OIDC + provenance
```

## 5. 워크스트림별 설계

### 5.1 WS1 — CI 신설 및 테스트 결과 유실 제거 (#33)

**변경**

- `package.json`의 `test:node`에 `--test-concurrency=1`을 추가한다. 46초는 수용 가능한 비용이며, 결과 유실이 사라지는 편익이 압도적이다.
- `.github/workflows/CI.yaml`을 신설한다.
  - 트리거: `pull_request` + `push: ["main"]`
  - 매트릭스: `os: [ubuntu-latest, windows-latest]` × `node: [20, 22, 24]`
  - `fail-fast: false` — 한 조합이 깨져도 나머지 결과를 봐야 원인이 좁혀진다.
  - `permissions: contents: read` — 최소 권한.
  - 의존성이 0개이고 `package-lock.json`이 없으므로 설치 단계가 필요 없다. `actions/setup-python`으로 파이썬만 확보하면 `npm test`가 그대로 돈다.
- README에 CI 상태 배지를 추가한다.

**Windows를 매트릭스에 포함하는 이유**: 이슈 #15가 Windows CRLF 회귀였고 `tests/node/line-endings.test.js`가 그 회귀 가드다. Linux에서만 돌리면 그 테스트의 존재 의의가 사라진다.

**Node 20을 하한으로 두는 이유**: `package.json`의 `engines: ">=20.12"`와 `bin/project-auto-wizard.js`의 런타임 게이트가 20.12를 요구한다. 선언과 검증 범위를 일치시킨다.

### 5.2 WS2 — doctor Workflow permissions 오진 수정 (#34)

**변경**

- 해당 항목을 `WARN` → `INFO`로 낮춘다. 등급 판정 기준은 "사용자가 조치해야 하는가"이고, 마법사가 설치한 워크플로우만 쓴다면 조치가 불필요하다.
- 문구를 사실에 맞게 교정한다 — 마법사 워크플로우는 자체 `permissions` 선언으로 동작하며, 직접 추가한 워크플로우가 `permissions`를 생략한 경우에만 이 기본값의 영향을 받는다.
- `value`(현재값)는 계속 보여준다. 정보로서의 가치는 있다.

**회귀 가드**: `payload/workflows/common/*.yaml`이 전부 `permissions:`를 선언하는지 검사하는 테스트를 추가한다. 이 전제가 깨지면 doctor의 판정 근거도 무너지므로, 나중에 누가 선언을 빠뜨리면 테스트가 먼저 잡아야 한다.

### 5.3 WS3 — 배포를 Release 트리거 + Trusted Publishing으로 전환 (#35)

**변경 ① 트리거 이동**

```yaml
on:
  release:
    types: [published]
  workflow_dispatch:
```

`push: branches: ["main"]`을 **제거**한다. 이것이 레이스의 원인이다.

체크아웃도 `ref: main`에서 **릴리스 태그**로 바꾼다. 태그는 불변 스냅샷이므로 "무엇이 배포되는가"가 타이밍과 무관해진다.

**변경 ② `RELEASE-PUBLISH`가 `WORKFLOW_PAT`으로 Release를 생성**

GitHub 정책상 `GITHUB_TOKEN`이 만든 이벤트는 다른 워크플로우를 트리거하지 않는다. 현재 `RELEASE-PUBLISH`는 `GH_TOKEN: ${{ github.token }}`으로 `gh release create`를 수행하므로, 트리거를 옮겨도 `NPM-PUBLISH`가 영원히 뜨지 않는다. 이 레포에는 `WORKFLOW_PAT`이 이미 등록되어 있다(doctor 확인).

`secrets.WORKFLOW_PAT`이 없는 환경에서도 릴리스 자체는 계속 동작해야 하므로 `${{ secrets.WORKFLOW_PAT || github.token }}` 폴백을 쓴다. payload 워크플로우는 사용자 레포에도 설치되며 그쪽엔 PAT이 없을 수 있다.

**변경 ③ Trusted Publishing (OIDC) + provenance**

`NPM-PUBLISH.yaml`에는 이미 `permissions: id-token: write`가 선언되어 있는데 정작 `NODE_AUTH_TOKEN: secrets.NPM_TOKEN`을 쓰고 `--provenance`도 없다 — 반쯤 준비해 두고 안 쓰는 상태다.

`npm publish --provenance --access public`으로 전환하면:

- npm 패키지 페이지에 어느 커밋·워크플로우에서 빌드됐는지 검증 가능한 provenance가 붙는다.
- npmjs.com에서 Trusted Publisher를 등록하면 `NPM_TOKEN` 시크릿 자체가 불필요해진다(유출·만료·회전 관리 소멸).

**호환성 주의**: Trusted Publisher 등록은 npmjs.com 웹에서 사람이 해야 하는 작업이다. 등록 전까지는 `NODE_AUTH_TOKEN`을 유지해야 배포가 끊기지 않는다. 따라서 **provenance 먼저, 토큰 제거는 등록 확인 후**라는 2단계로 나눈다.

**변경 ④ 배포 전 테스트 게이트**

`NPM-PUBLISH`에 테스트 실행 단계를 추가한다. WS1이 선행되어야 의미가 있으므로 WS3은 WS1에 의존한다.

### 5.4 WS4 — develop 복구 (#36)

- `origin/develop`을 `origin/main`으로 fast-forward한다. 앞선 커밋이 0개이므로 이력 왜곡 없이 전진만 하면 된다.
- `origin/develop-1`의 정체를 확인하고 불필요하면 삭제한다.
- 이후 작업은 `CONTRIBUTING.md`대로 develop 기준 경로로 되돌린다.

**실행 순서상 마지막에 둔다.** 배포 파이프라인이 안정화되기 전에 릴리스 PR 경로로 전환하면, 문제가 생겼을 때 원인이 파이프라인 변경인지 경로 변경인지 구분되지 않는다.

## 6. 워크스트림 의존 관계와 실행 순서

```
WS1 (CI·테스트)  ──필수 선행──▶  WS3 (배포 전환)
                                      │
WS2 (doctor 오진) ─독립─              │
                                      ▼
                                 WS4 (develop 복구)
```

| 순서 | 워크스트림 | 근거 |
|---|---|---|
| 1 | **WS1** | 가장 큰 공백이자 이후 모든 변경의 안전망. 배포 파이프라인을 손대다 깨뜨려도 CI가 잡는다 |
| 2 | **WS2** | 독립적이고, v0.1.20에 이미 배포된 오진이라 빨리 걷어내야 한다 |
| 3 | **WS3** | WS1의 테스트 게이트가 있어야 "검증된 것만 배포"가 성립한다 |
| 4 | **WS4** | 파이프라인 안정화 후 정상 경로로 복귀 |

## 7. 검증 방법

| 워크스트림 | 검증 |
|---|---|
| WS1 | `npm run test:node`가 327 pass / 0 fail로 안정적으로 나오는지 반복 확인. PR에 CI 체크 6개(2 OS × 3 Node)가 뜨고 전부 통과하는지 |
| WS2 | `node bin/project-auto-wizard.js --mode doctor`가 이 레포에서 해당 항목을 `[i]`로 출력하는지. payload permissions 회귀 테스트 통과 |
| WS3 | 실제 릴리스가 npm까지 도달하는지. npm 패키지 페이지에 provenance 배지가 붙는지. 누락 없이 연속 버전이 배포되는지 |
| WS4 | `git rev-list --left-right --count origin/main...origin/develop`이 `0 0`인지 |
| 전체 | `EarLocAlert`에서 `npx project-auto-wizard`로 대화형 설치 실사용 — doctor 출력·메뉴 복귀·설치 흐름 |

## 8. 범위 밖

- **`--mode status` 출력 톤 통일** — doctor와 같은 평문 나열 문제가 있으나 릴리스 파이프라인과 무관하다. 별도 이슈로 다룬다.
- **누락된 0.1.13·0.1.15·0.1.19의 소급 배포** — 이미 상위 버전이 배포되어 실익이 없다. 원인 제거로 재발만 막는다.
- **`payload/`의 릴리스 워크플로우 재설계** — 사용자 레포에 설치되는 워크플로우는 이번 변경 대상이 아니다. 단, WS3 변경 ②(`WORKFLOW_PAT` 폴백)는 payload에도 반영되므로 도그푸딩 동기화가 필요하다.
