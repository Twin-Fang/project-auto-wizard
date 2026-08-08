# Flutter 워크플로우에 build_runner 코드 생성 단계 없음 — 브레인스토밍 결과

- 날짜: 2026-08-08
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#42](https://github.com/Twin-Fang/project-auto-wizard/issues/42)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈), [#38](https://github.com/Twin-Fang/project-auto-wizard/issues/38)/[#39](https://github.com/Twin-Fang/project-auto-wizard/issues/39) (같은 트래킹 이슈에서 이미 해결된 개별 Flutter CI 결함 — 동일한 스펙/플랜 문서 컨벤션을 따름)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션(플랜 문서)에서 다룬다. 이번 세션은 사용자 요청("코드 수정 금지 · 계획부터 수립")에 따라 스펙과 플랜 문서만 작성하고, YAML/테스트 파일은 건드리지 않는다.

## 1. 배경 — 문제 정의

`payload/workflows/flutter/` 아래 7개 워크플로우 파일이 `flutter pub get`만 실행하고 **코드 생성(`build_runner`)을 실행하지 않는다.** `freezed` · `riverpod_generator` · `drift` · `json_serializable` 중 하나라도 사용하는 프로젝트는 `*.g.dart` · `*.freezed.dart` 생성 파일이 없는 상태로 `flutter analyze`/빌드에 들어가 전부 실패한다.

```
error • Target of URI hasn't been generated:
        'package:ear_loc_alert/app/geofence_providers.g.dart'
error • Target of URI doesn't exist:
        'package:ear_loc_alert/app/background/pending_alert.freezed.dart'
error • Classes can only mix in mixins and classes
error • The name '_PendingAlert' isn't a type and can't be used in a redirected constructor
```

진단이 어려운 이유: 실제 원인은 목록 맨 위의 `uri_has_not_been_generated` 한 줄인데, 그 아래 수십 건의 `undefined_getter`/`undefined_identifier`가 앱 코드 라인을 가리켜서 자기 코드가 깨진 것으로 오인하기 쉽다.

이슈 제보자는 통합 **이전** 자신의 워크플로우에 이 단계가 있었고, 마법사가 워크플로우를 덮어쓰면서 사라졌다고 보고했다(v0.1.18 기준). `freezed`/`riverpod_generator`를 쓰고 `.gitignore`에 `*.g.dart`/`*.freezed.dart`가 있는(생성 파일을 커밋하지 않는) 표준 구성이면 즉시 재현된다.

## 2. 현재 상태 조사 (완료)

`grep -c build_runner payload/workflows/flutter/*.yaml` — 8개 파일 전부 0.

`flutter pub get` 발생 위치 — 7개 파일, 총 14곳 (이슈 제보자가 보고한 "7개 파일 14곳"과 일치):

| 파일 | 줄 번호 | 개수 |
|---|---|---|
| `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` | 115, 268, 330 | 3 |
| `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` | 100, 258, 320 | 3 |
| `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml` | 136 | 1 |
| `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` | 390 | 1 |
| `PROJECT-FLUTTER-CI.yaml` | 280, 379, 507 | 3 |
| `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` | 157, 293 | 2 |
| `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` | 545 | 1 |
| **합계** | | **14** |

`PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml`은 `flutter pub get`이 0곳이다 — 다른 워크플로우를 트리거만 하는 디스패처 워크플로우로, 코드 생성이 필요한 빌드/분석 단계 자체가 없다.

각 위치는 세 가지 형태 중 하나로 나타난다:

**형태 A — 단독 한 줄 스텝** (`PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml:115,268`, `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml:100,258`, `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml:157,293`, `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml:545`):

```yaml
      - name: Install dependencies
        run: flutter pub get
```

**형태 B — 여러 줄 블록 스칼라의 첫 명령** (`PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml:136`, `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml:390`, `PROJECT-FLUTTER-CI.yaml:280,379,507`):

```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          echo "✅ Dependencies installed"
```

**형태 C — 실제 빌드 스텝 안에 `flutter clean` 뒤이어 임베드** (`PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml:330`, `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml:320` — 둘 다 "Build Android App Bundle (AAB)" 스텝 내부, `flutter build appbundle` 실행 직전):

```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
          ...
```

이 세 형태는 모두 "`flutter pub get` 직후, 다음 명령 실행 전"이라는 동일한 삽입 지점을 가진다.

## 3. 목표 / 비목표

**목표**: 14곳 전부에서 `flutter pub get` 직후 build_runner 조건부 코드 생성을 실행해, `freezed`/`riverpod_generator`/`drift`/`json_serializable`을 쓰는 프로젝트의 `flutter analyze`/빌드가 생성 파일 부재로 실패하지 않게 한다.

**비목표**:
- `pubspec.yaml` 파싱을 `yq` 등으로 정교화하지 않는다. 사용자가 브레인스토밍에서 이슈 제안 그대로(`grep -q "build_runner" pubspec.yaml`)를 선택했다 — 오탐 가능성(예: `dependency_overrides`의 주석에 문자열만 존재)은 낮고, CI 러너에 `yq` 설치를 보장할 필요가 없어 더 단순하다.
- `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml`은 범위 밖 — `flutter pub get` 자체가 없는 디스패처 워크플로우이므로 사용자가 브레인스토밍에서 제외를 확정했다.
- `dart_tool/build` 캐싱, `build_runner` 전용 GitHub Actions 캐시 키 추가 등 성능 최적화는 다루지 않는다 — 이슈 제안에도 없고, CI처럼 매번 클린 체크아웃하는 환경에서는 `--delete-conflicting-outputs`로 캐시 충돌 자체를 피하는 것으로 충분하다.
- `.gitignore` 템플릿(생성 파일 커밋 여부)은 이 저장소가 배포하지 않는 영역이다(`payload/`에 gitignore 템플릿 없음, 확인됨) — 다루지 않는다.
- `.github/workflows/`(이 레포 자신의 dogfooding 산출물)에는 Flutter 관련 워크플로우가 존재하지 않는다(확인됨, `#38`/`#39` 스펙에서도 동일하게 확인됨) — 수동 동기화 대상이 없다.
- 이슈 #37에 묶인 다른 개별 이슈(#40, #41)는 이 스펙의 범위 밖.

## 4. 설계

### 4.1 삽입할 조건부 코드 생성 블록

모든 14곳에 동일한 로직을 삽입한다:

```
if grep -q "build_runner" pubspec.yaml; then
  dart run build_runner build --delete-conflicting-outputs
fi
```

- `grep -q "build_runner" pubspec.yaml`: `build_runner`를 `dev_dependencies`에 선언하지 않은 프로젝트(코드 생성 미사용)에서는 이 단계를 건너뛰어 불필요한 오버헤드와 "codegen 필요 없음" 에러를 피한다.
- `--delete-conflicting-outputs`: 클린 체크아웃인 CI에서는 사실상 무해하고, 캐시가 섞였을 때(`~/.pub-cache` 복원 등) 생기는 출력 충돌을 막는다. 이슈 제보자가 실전 검증한 플래그.
- YAML 블록 스칼라(`run: |`) 안에 들어가므로, 삽입 시 기존 명령들과 **동일한 들여쓰기(10칸 공백)**를 유지해야 한다 — `tests/node/payload-yaml.test.js`의 `#40` 회귀 가드(블록 스칼라 이탈 검사)를 통과하려면 필수.

### 4.2 형태별 적용 방식

**형태 A → 형태 B로 전환** (단독 `run: flutter pub get`을 블록 스칼라로 승격):

```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
```

**형태 B → `flutter pub get` 바로 다음 줄에 삽입, 기존 후속 명령은 그대로 유지**:

```yaml
      - name: Install dependencies
        run: |
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi
          echo "✅ Dependencies installed"
```

**형태 C → `flutter pub get` 바로 다음 줄에 삽입, 로그는 추가하지 않는다**:

```yaml
          # Flutter clean 및 pub get
          echo "🔄 Flutter clean 및 의존성 재설치..."
          flutter clean
          flutter pub get
          if grep -q "build_runner" pubspec.yaml; then
            dart run build_runner build --delete-conflicting-outputs
          fi

          # local.properties에 버전 정보 추가 (Flutter 플래그가 무시되는 문제 해결)
          ...
```

세 형태 모두 삽입 스니펫은 완전히 동일하다(로그 라인 없음). 이 스텝이 이미 이모지 로그 스타일을 쓰고 있더라도, 이슈 제안에 없는 로그를 추가하는 것은 "이슈 원안 그대로" 채택 결정 및 최소 변경 원칙(`CLAUDE.md` — 요청받지 않은 기능 추가 금지)에 어긋난다. 세 형태의 차이는 오직 "어디에 삽입하느냐"일 뿐, 삽입하는 내용 자체는 하나의 스니펫으로 통일한다.

### 4.3 테스트 계획

`tests/node/payload-yaml.test.js`가 이미 문자열 단언으로 워크플로우 내용을 검증하는 패턴(`#38`/`#39` 절, 92~313번째 줄)을 갖고 있으므로 동일한 스타일을 따른다.

파일마다 아래 형태의 테스트를 하나씩 추가한다(총 7개, 파일당 1개):

```js
test("<파일명>: flutter pub get 직후 build_runner 조건부 코드 생성이 있다 (#42)", () => {
  const body = readFileSync(<path>, "utf8");
  const pattern = /flutter pub get\n( *)if grep -q "build_runner" pubspec\.yaml; then\n *dart run build_runner build --delete-conflicting-outputs\n *fi/g;
  const matches = body.match(pattern) || [];
  const pubGetCount = (body.match(/flutter pub get/g) || []).length;
  assert.strictEqual(matches.length, pubGetCount, `...`);
});
```

- 정규식이 이 파일의 다른 테스트들처럼 정규식/문자열 단언 스타일을 유지하되, "고정된 매직 넘버"가 아니라 "같은 파일 안에서 `flutter pub get` 개수와 가드 개수가 정확히 일치하는지"를 검증한다 — 이렇게 하면 (a) 수정 전에는 반드시 FAIL(현재 가드가 0개이므로)하고, (b) 수정 후 PASS하며, (c) 이후 누군가 `flutter pub get`을 추가로 넣고 가드를 빠뜨리면 다시 회귀를 잡아낸다.
- 정규식은 `flutter pub get` 바로 다음 줄에 가드가 있는지(인접성)까지 검증하므로, "파일 어딘가에 가드 문자열이 있기만 하면 통과"하는 느슨한 단언보다 강하다.
- `PROJECT-FLUTTER-SUH-LAB-APP-BUILD-TRIGGER.yaml`은 애초에 `flutter pub get`이 없으므로 테스트 대상에서 제외한다(비목표 4항과 일치).

## 5. 위험 및 롤백

- 위험은 낮다: 템플릿 파일 7개에 대한 반복적인 문자열 삽입 + 텍스트 단언 테스트 추가뿐이며, 런타임 로직(`src/`, `bin/`)에는 영향이 없다.
- 가장 흔한 실수 지점은 YAML 블록 스칼라 들여쓰기 오류(공백 개수 불일치)다 — 기존 `tests/node/payload-yaml.test.js`의 `#40` 회귀 가드(`findBlockScalarIndentationViolations`)가 전체 payload 워크플로우에 대해 이미 실행되므로, 들여쓰기가 어긋나면 플랜의 별도 테스트 없이도 기존 스위트가 잡아낸다.
- 이미 이 워크플로우로 설치된 기존 사용자 프로젝트는 이번 수정으로 자동 갱신되지 않는다(payload는 설치/업그레이드 시점에만 반영됨) — 이는 이 프로젝트의 기존 배포 모델이며 이 스펙의 범위 밖이다.
- 롤백은 단순 revert로 충분하다(파일별 독립 커밋 권장 — 플랜 문서에서 파일당 1커밋으로 분리).
