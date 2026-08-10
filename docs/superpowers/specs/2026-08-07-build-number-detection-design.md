# 신규 통합 시 빌드 번호(version_code) 미감지로 인한 스토어 업로드 거부 — 브레인스토밍 결과

- 날짜: 2026-08-07
- 상태: 브레인스토밍 완료 — 구현 계획 단계로 진행
- 이슈: [Twin-Fang/project-auto-wizard#41](https://github.com/Twin-Fang/project-auto-wizard/issues/41)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

Flutter 프로젝트에 **신규 통합**할 때 `pubspec.yaml`의 빌드 번호(`version: x.y.z+N`의 `+N`)를 읽지 않아 `version.yml`의 `version_code`가 `1`로 초기화된다. 그 뒤 릴리스 워크플로우가 `pubspec.yaml`을 되쓰면서 빌드 번호가 역행하고, Google Play가 업로드를 거부한다.

```
통합 전 pubspec: 1.2.39+71   →   통합 후 생성된 version.yml: version_code: 1
```

```python
# payload/scripts/version_manager.py:328-341 sync_flutter() — 다음 릴리스에서 이렇게 되쓴다
full_version = f"{new_version}+{version_code}"   # 1.2.40+2  ← 71에서 역행
```

```
Version code 2 has already been used. Try another version code.
```

Android 빌드 번호는 단조 증가가 계약이라 한 번 역행하면 되돌릴 수 없다. 통합 시점에는 증상이 없고 **다음 배포를 시도할 때** 드러난다.

### 근본 원인 (코드로 확인됨)

`versionCode`는 두 개의 동일한 호출부에서 각각 독립적으로 결정된다 — **둘 다** `existing?.versionCode ?? 1`:

- `src/commands/interactive.js:88`
- `src/index.js:240`

신규 통합에서는 `existing`(기존 `version.yml` 파싱 결과)이 `null`이므로 `versionCode`가 무조건 `1`로 고정되고, `pubspec.yaml`의 실제 `+N`은 전혀 조회되지 않는다. `src/core/detect.js:51`의 `detectVersionFromFiles()`도 `x.y.z`만 잡고 `+N`은 애초에 버린다.

재통합(기존 `version.yml`이 있는 경우) 시 보존 로직(`existing?.versionCode`)은 이미 올바르게 동작한다 — **신규 통합 경로에만 해당하는 결함**이다.

## 2. 목표 / 비목표

**목표**: 신규 통합 시 프로젝트 파일에 이미 기록된 빌드 번호를 감지해 `version.yml`의 `version_code`에 반영하고, 잘못 감지됐을 때 통합 요약에서 바로 눈에 띄게 하며, `version_code`를 직접 낮은 값으로 쓰려는 시도를 경고한다.

**비목표**:
- **iOS `Info.plist`(`CFBundleVersion`) 감지는 포함하지 않는다.** Flutter/react-native/react-native-expo와 달리 Info.plist는 경로·파일명이 Xcode 프로젝트마다 달라(`version_manager.py`의 `sync_react_native()`도 `rglob`으로 재귀 탐색) 순수 함수 계층(`detect.js`)에 디렉터리 순회 primitive를 새로 추가해야 한다. 이번 이슈의 실제 재현·근본 원인은 Android(Play Store) 경로이므로 범위에서 제외한다. 필요해지면 별도 이슈로 다룬다.
- **react-native / react-native-expo의 빌드 번호는 "감지+표시"까지만 다루고, write-back(스토어 배포 시 실제로 되쓰는 로직)은 이번 스펙에 포함하지 않는다.** `payload/scripts/version_manager.py`의 `sync_react_native()`(372-400번째 줄)와 `sync_for_type()`의 `react-native-expo` 분기(415-416번째 줄)를 확인한 결과, 두 타입 모두 마케팅 버전 문자열만 동기화하고 `versionCode`/`buildNumber` 계열 필드는 애초에 쓰지 않는다. 즉 이 두 타입은 **현재 write-back이 없으므로 실제 역행(regression)이 발생할 수 없다** — 이번 감지 추가는 `version.yml`을 정확하게 채우고 통합 요약에 보여주는 예방적 조치이며, Flutter처럼 "이미 벌어지고 있는 역행 버그"를 고치는 것은 아니다. 향후 RN/Expo에 write-back이 추가되면 그때 이 감지값이 유용해진다.
- `set_version_code()`의 역행 방지는 **경고만 출력(warn-only)** — 프로세스를 막지 않는다. 이번 사고 자체(신규 통합 시 `1`로 초기화)는 이 가드로 잡히지 않는다(`1 → 2`는 `version.yml` 기준으로는 역행이 아니므로) — 이는 향후 다른 경로의 수동 실수를 막는 2차 안전장치다.
- 이슈 #37에 함께 묶인 다른 개별 이슈(#38, #39, #40, #42)는 이 스펙의 범위 밖 — 별도 이슈에서 다룬다.

## 3. 설계

### 3.1 빌드 번호 감지 — `src/core/detect.js`

`detectVersionFromFiles`와 나란히, 타입 인식 신규 순수 함수 `detectBuildNumberFromFiles({ types, read, warn })`를 추가한다. `types` 배열에서 먼저 매칭되는 첫 타입을 사용한다(다른 감지 로직들이 이미 `types[0]`을 primary로 취급하는 것과 동일한 관례).

| 타입 | 소스 파일 | 패턴 |
|---|---|---|
| flutter | `pubspec.yaml` | `/^version:\s*\d+\.\d+\.\d+\+(\d+)/m` |
| react-native | `android/app/build.gradle` (고정 상대경로 — `version_manager.py`의 `sync_react_native()`가 쓰는 경로와 동일, `tests/fixtures/e2e/react-native/android/app/build.gradle`로 확인됨) | `/versionCode\s+(\d+)/` |
| react-native-expo | `app.json` → `expo.android.versionCode` | JSON 키 조회 |
| 그 외 | — | `null`, 경고 없음 (빌드 번호 개념이 없는 타입은 정상 상황) |

동작 세부:
- 해당 타입의 마커 파일 자체가 없음 → `null`, 경고 없음(다른 타입 프로젝트이므로 정상).
- 마커 파일은 있는데 빌드 번호 필드가 없거나 파싱 실패 → `null` **이고 경고 발생** — 이것이 이슈에서 실제로 벌어진 "조용한 실패" 모드이므로 반드시 알려야 한다.
- 감지 성공 → 정수 반환.

`src/core/detect-fs.js`에 `detectVersion`과 동일한 패턴(`warn = (m) => console.error(m)` 기본값)을 따르는 실 파일시스템 래퍼 `detectBuildNumber(root, { types, warn })`를 추가한다.

### 3.2 신규 통합 호출부 연결

두 호출부 모두 `?? 1` 폴백 직전에만 삽입한다(재통합의 `existing.versionCode` 보존 경로는 손대지 않는다):

- `src/commands/interactive.js:88`
- `src/index.js:240`

```js
const versionCode = existing?.versionCode ?? detectBuildNumber(cwd, { types }) ?? 1;
```

두 파일 모두 이 시점에 `types`가 이미 계산되어 있어(각각 84번째 줄, 237번째 줄) 순서 변경이 필요 없다.

### 3.3 통합 요약에 빌드 번호 표시 (이슈 제안 3)

`src/ui/summary.js`의 `printSummary(ctx)`는 현재 `{ mode, types, version, copiedFiles, branches, gitignoreUpdated }`만 받고 58번째 줄에서 `📄 version.yml (버전: ..., 타입: ...)`만 출력한다. `versionCode`는 두 호출부(`interactive.js:252`의 `io.summary?.({...})`, `index.js:316`의 `printSummary({...})`) 모두 로컬 스코프에 이미 있지만 현재 전달되지 않는다.

- 두 호출부의 ctx 객체에 `versionCode`를 추가한다.
- `summary.js`에서 `types`가 flutter/react-native/react-native-expo 중 하나를 포함하면, 기존 `📄 version.yml` 줄 바로 아래에 한 줄 추가한다:
  ```
  📄 version.yml (버전: 1.2.39, 타입: flutter)
     빌드 번호: 71 (pubspec.yaml에서 감지)
  ```
- 감지 실패로 `1`(기본값)이 된 경우에도 그대로 표시한다 — 이슈 리포터가 지적한 대로, 잘못된 값이 통합 시점에 눈에 보이는 것 자체가 안전장치다.

### 3.4 역행 방지 경고 — `payload/scripts/version_manager.py:223` `set_version_code()`

현재 구현은 무조건 덮어쓴다. `new_code`가 현재 저장된 값보다 작으면 기존 `log()` 헬퍼로 `WARNING`을 출력하되, 값은 그대로 쓴다(프로세스를 막지 않음 — warn-only로 결정됨).

```python
def set_version_code(new_code):
    current = get_version_code()
    if current not in (None, "") and int(new_code) < int(current):
        log(f"WARNING: version_code {new_code} is lower than current {current} — writing anyway (regression?)")
    ...  # 기존 쓰기 로직 그대로
```

## 4. 테스트 계획

- **단위 테스트** (`tests/node/detect-version.test.js` 또는 신규 형제 파일) — `detectBuildNumberFromFiles`의 기존 `detectVersionFromFiles` 테스트와 동일한 스타일:
  - flutter: `1.2.39+71` → `71`
  - flutter: `+N` 없음 → `null` + warn 1회 호출
  - flutter: `pubspec.yaml` 없음 → `null`, warn 없음
  - react-native: `android/app/build.gradle`의 `versionCode 71` → `71`
  - react-native-expo: `app.json`의 `expo.android.versionCode: 71` → `71`
- **E2E** (`tests/node/e2e-matrix.test.js`) — `tests/fixtures/e2e/flutter/pubspec.yaml`을 `1.0.0+1`에서 `1.2.39+71`로 변경하고, 신규 `--type flutter` 설치가 `version.yml`에 `version_code: 71`을 생성하는지 단언한다. 이슈의 재현 시나리오 그대로이며, 트래킹 이슈 #37이 명시적으로 요청한 "신규 통합 직후 version_code가 pubspec의 +N과 일치하는지 단언하는 테스트"를 충족한다.
- **Python** (`tests/py/test_version_manager.py`) — `set_version_code`를 현재 값보다 낮은 값으로 호출해도 값은 그대로 쓰여지고, WARNING이 로그에 남는지 검증하는 신규 테스트 케이스 추가.
- 기존 `tests/py/test_version_sync.py`는 변경 불필요 — Python 동기화 계층만 다루며, 이번 버그의 핵심인 JS 신규 통합 감지 로직과는 무관하다.

## 5. 위험 및 롤백

- 위험은 낮다: 새 순수 함수 추가 + 두 호출부의 `?? 1` 폴백 앞에 감지 호출 삽입 + summary 출력 한 줄 추가 + Python 경고 로그 추가. 기존 재통합 경로(가장 흔한 실사용 경로)는 전혀 건드리지 않는다.
- 감지 실패(정규식 불일치 등)는 항상 `null`로 안전하게 폴백해 기존 동작(`1`)과 동일하다 — 새 코드가 예외를 던져 통합을 중단시킬 여지가 없다.
- 이미 이 결함으로 `version_code`가 잘못 초기화된 기존 사용자 프로젝트는 이번 수정으로 자동 복구되지 않는다(감지는 신규 통합 시점에만 동작) — 해당 사용자는 이슈 리포터처럼 `version.yml`을 수동으로 고쳐야 한다. 이는 이 스펙의 범위 밖이며, 재통합 시 자동 보정 로직은 별도 이슈로 다룰 수 있다.
- 롤백은 단순 revert로 충분하다.
