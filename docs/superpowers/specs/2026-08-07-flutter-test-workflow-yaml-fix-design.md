# 템플릿 워크플로우 2개가 유효한 YAML이 아님 — 브레인스토밍 결과

- 날짜: 2026-08-07
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#40](https://github.com/Twin-Fang/project-auto-wizard/issues/40)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈), #38·#39 (같은 트래킹 이슈 산하, 별도 스펙에서 이미 처리됨), #41·#42 (같은 트래킹 이슈 산하, 이 스펙의 범위 밖)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

`payload/workflows/flutter/` 아래 다음 2개 워크플로우 파일이 유효한 YAML이 아니다.

- `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`
- `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`

원인은 `run: |` 블록 스칼라 안에 작성된 heredoc(`cat > file << EOF ... EOF`)의 본문과 종료자(`EOF`)가 **컬럼 0**에 그대로 쓰여 있기 때문이다. YAML 파서는 블록 스칼라의 들여쓰기가 스칼라 키보다 얕아지는 지점에서 블록이 끝난 것으로 해석하므로, 그 이후 문서 구조가 깨진다. `js-yaml`로 직접 파싱해 재현했다.

```
FAIL PROJECT-FLUTTER-ANDROID-TEST-APK.yaml -> YAMLException (can not read a block mapping entry; a multiline key may not be an implicit key)
FAIL PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml -> YAMLException (expected ':' after a mapping key)
```

이슈 본문은 각 파일에서 1곳씩만 예시로 들었지만, 실제로 컬럼 0 이탈은 **각 파일에 여러 곳** 있다(이슈가 명시한 "22줄 · 12줄"과 정확히 일치).

- `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` — 3곳
  - 335~340행: `key.properties` 생성
  - 636~667행: `build-info.txt` 생성 (`cat >`/`cat >>` 3개 블록)
  - 676~683행: `build-metadata.json` 생성
- `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` — 2곳
  - 320~328행, 336~341행: `final_release_notes.txt` 생성 (`cat >`/`cat >>` 2개 블록)
  - 618~627행: `build-metadata.json` 생성

`payload/workflows` 전체 28개 파일 중 이 2개만 실제로 파싱에 실패한다는 것을 별도 스캔(모든 파일에서 "주석이 아니면서 컬럼 0에 있는 줄"이 최상위 YAML 키 개수를 초과하는지 확인)으로 확인했다. 같은 디렉터리의 다른 파일들(`PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`, `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`, `PROJECT-FLUTTER-CI.yaml`, `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`)는 이미 heredoc 본문을 블록 스칼라 들여쓰기(10칸)에 맞춰 올바르게 작성돼 있다 — 참고할 검증된 스타일이 이미 존재한다.

### 근본 원인 — 재발 방지 공백

기존 `tests/node/payload-yaml.test.js`는 `payload/workflows` 전체 파일을 열거하지만, 문자열 포함 여부(`includes`)나 정규식 검사만 수행하고 **실제 YAML 파서로 파싱 검증을 하지 않는다.** 이것이 이 버그가 릴리스(v0.1.18)를 통과한 근본 원인이며, 이슈의 "재발 방지 제안" 섹션이 정확히 지적하는 공백이다.

이 프로젝트는 `package.json`에 `dependencies`가 0개이고 `package-lock.json`도 없는 **의도적인 무의존성 정책**을 갖고 있다(`.github/workflows/CI.yaml` 주석: "의존성이 0개이고 package-lock.json이 없으므로 설치 단계가 없다"). 이슈가 제안한 `actionlint`나 Python `pyyaml` 기반 검증은 CI에 설치 단계를 추가해야 해 이 정책과 충돌한다.

## 2. 목표 / 비목표

**목표**:
1. 두 파일의 YAML 들여쓰기를 고쳐 유효한 YAML로 만든다(내용은 변경하지 않는다 — 들여쓰기만 조정).
2. 같은 버그 클래스(블록 스칼라 이탈)가 향후 다른 템플릿 파일에서 재발해도 CI가 잡아내도록 `tests/node/payload-yaml.test.js`에 검사를 추가한다.

**비목표**:
- 트래킹 이슈 #37 산하 다른 개별 이슈(#41 `version_code` 역행, #42 `build_runner` 누락)는 다루지 않는다.
- 이 2개 파일 외 다른 워크플로우 파일의 스타일 개선이나 리팩터링은 하지 않는다.
- 완전한 YAML 문법 검사기(`actionlint`, `js-yaml` 등 외부 도구 도입)는 도입하지 않는다 — 무의존성 정책 유지가 우선이며, 이번 버그 클래스에 특화된 자체 검사로 충분하다.
- `.github/workflows/`(이 레포 자신에게 설치된 dogfooding 산출물)에는 Flutter 관련 워크플로우가 존재하지 않으므로 수동 동기화 대상이 없다.

## 3. 설계

### 3.1 파일 수정 — 들여쓰기 정렬

두 파일에서 컬럼 0에 있는 모든 heredoc 본문·종료자를 해당 `run: |` 스텝의 블록 스칼라 들여쓰기(10칸)에 맞춰 재들여쓰기한다. 내용(변수, 텍스트)은 한 글자도 바꾸지 않는다 — YAML은 블록 스칼라의 공통 들여쓰기를 제거하고 쉘에 넘기므로, heredoc이 쉘에서 실제로 보는 내용은 이전과 동일하게 유지된다(이슈 본문이 제시한 해결 방식과 동일).

예시 (`PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`, 이미 같은 디렉터리의 `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` 237~242행에서 검증된 패턴을 그대로 따른다):

```yaml
        run: |
          cat > android/key.properties << EOF
          storeFile=keystore/key.jks
          storePassword=$STORE_PASSWORD
          keyAlias=$KEY_ALIAS
          keyPassword=$KEY_PASSWORD
          EOF
```

동일한 방식을 두 파일의 나머지 4개 블록(위 1절에 나열)에도 적용한다.

### 3.2 재발 방지 검사기 — 순수 JS 블록 스칼라 들여쓰기 검사

외부 라이브러리 없이 `tests/node/payload-yaml.test.js`에 헬퍼 함수를 추가한다. 파일을 줄 단위로 훑으며:

1. `key: |`, `key: >` (접미사 `-`/`+` 허용) 형태로 끝나는 줄을 블록 스칼라 시작으로 인식하고, 그 줄의 들여쓰기보다 최소 1칸 이상 깊은 들여쓰기를 "블록 내부 최소 들여쓰기"로 기대한다.
2. 블록 시작 다음 줄부터, 비어있지 않은 줄의 들여쓰기가 기대치보다 얕아지면 그 시점에 블록이 끝난 것으로 보고 검사를 종료한다.
3. 블록이 끝나기 전, 비어있지 않은 줄의 들여쓰기가 기대치보다 얕으면(=컬럼 0을 포함해 블록 스칼라를 이탈하면) 실패로 기록한다.
4. 빈 줄은 들여쓰기 검사에서 건너뛴다(YAML 블록 스칼라에서 빈 줄은 들여쓰기 규칙의 예외).

이 검사기는 완전한 YAML 문법 검사기가 아니라 **"블록 스칼라 이탈"이라는 이번 버그 클래스에 특화된 가드**다. 위반 시 파일명·줄 번호·해당 줄 내용을 assert 메시지에 포함해 실패 원인을 즉시 알 수 있게 한다.

검사 대상은 기존 `files` 배열(`payload/workflows` 전체 28개 파일)을 그대로 재사용한다. 테스트는 기존 파일의 스타일(하나의 `test()` 블록 안에서 전체 파일을 순회, 위반 시 `assert.fail`)을 따른다.

## 4. 테스트 계획

TDD 순서로 진행한다:

1. **RED**: 수정 전 상태에서 새 검사 테스트를 먼저 추가해, 두 파일에서 정확히 실패하는지 확인한다(검사기가 실제로 이 버그 클래스를 잡아내는지 검증).
2. 두 파일의 들여쓰기를 3.1에 따라 수정한다.
3. **GREEN**: `npm run test:node`로 새 테스트와 `payload-yaml.test.js`의 기존 테스트 전체가 통과하는지 확인한다.
4. 임시로 `js-yaml`(devDependency로 추가하지 않고, 로컬 검증 목적으로만 1회 실행)로 두 파일을 개별 파싱해 유효한 YAML이 되었는지 재확인한다.
5. `npm test`(Node + Python 스위트 전체)로 회귀가 없는지 확인한다.

## 5. 위험 및 롤백

- 위험은 낮다: 두 파일은 들여쓰기만 바뀌고 내용은 동일하며, 새 테스트는 읽기 전용 정적 검사만 추가한다. `src/`, `bin/`의 런타임 로직에는 영향이 없다.
- 새 검사기가 과도하게 엄격해 기존에 통과하던 다른 26개 파일에서 오탐(false positive)을 낼 가능성이 있다 — 4절의 GREEN 단계에서 `npm run test:node` 전체 통과로 이를 확인한다.
- 이미 이 워크플로우로 설치된 기존 사용자 프로젝트는 이번 수정으로 자동 갱신되지 않는다(payload는 설치/업그레이드 시점에만 반영됨) — 이는 이 프로젝트의 기존 배포 모델이며 이 스펙의 범위 밖이다.
- 롤백은 단순 revert로 충분하다.
