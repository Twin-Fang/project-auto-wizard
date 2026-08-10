# FLUTTER_ROOT가 subosito/flutter-action의 SDK 경로와 이름 충돌 — 브레인스토밍 결과

- 날짜: 2026-08-08
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#50](https://github.com/Twin-Fang/project-auto-wizard/issues/50)
- 관련: [Twin-Fang/project-auto-wizard#37](https://github.com/Twin-Fang/project-auto-wizard/issues/37) (통합 후 발견한 결함 묶음 트래킹 이슈 — 이슈 #50도 이 클러스터에 트래킹됨), [#38](https://github.com/Twin-Fang/project-auto-wizard/issues/38)/[#39](https://github.com/Twin-Fang/project-auto-wizard/issues/39)/[#40](https://github.com/Twin-Fang/project-auto-wizard/issues/40)/[#42](https://github.com/Twin-Fang/project-auto-wizard/issues/42) (같은 트래킹 이슈에서 이미 해결된 개별 Flutter CI 결함 — 동일한 스펙/플랜 문서 컨벤션을 따름)
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션(플랜 문서)에서 다룬다. 이번 세션은 사용자 요청("코드 수정 금지 · 계획부터 수립")에 따라 스펙과 플랜 문서만 작성하고, YAML/테스트 파일은 건드리지 않는다.

## 1. 배경 — 문제 정의

Flutter 배포 워크플로우 2개가 프로젝트 디렉토리(모노레포 지원용, 레포 루트 기준 상대 경로)를 담는 환경변수를 `FLUTTER_ROOT`라는 이름으로 정의한다. 그런데 **`subosito/flutter-action@v2`가 같은 이름(`FLUTTER_ROOT`)으로 Flutter SDK 설치 경로를 `$GITHUB_ENV`에 내보내 이 값을 덮어쓴다.**

GitHub Actions는 `$GITHUB_ENV`에 기록된 값을 이후 모든 스텝에 적용한다 — 워크플로우 상단의 정적 `env:` 블록이 먼저 선언되어 있어도, `flutter-action` 스텝이 실행된 이후부터는 `FLUTTER_ROOT`가 SDK 경로(`/opt/hostedtoolcache/flutter/...`)로 바뀐다.

그 결과 산출물 경로가 SDK 디렉토리 안을 가리켜 빌드는 성공하지만 업로드가 비게 되고, 다음 배포 잡이 아티팩트를 찾지 못해 죽는다:

```
✓ Built build/app/outputs/bundle/release/app-release.aab (52.5MB)
✅ AAB 빌드 및 검증 완료
```

```
##[warning]No files were found with the provided path:
/opt/hostedtoolcache/flutter/stable-3.35.5-x64/flutter/build/app/outputs/bundle/release/app-release.aab.
No artifacts will be uploaded.
```

```
##[error]Unable to download artifact(s): Artifact not found for name: android-aab
```

진단이 어려운 이유: `upload-artifact`는 파일이 없어도 기본적으로 warning만 내고 스텝 자체는 성공 처리한다. 그래서 빌드 잡은 초록으로 끝나고, "빌드는 됐는데 배포에서 아티팩트가 없다"는 형태로만 보여 원인이 경로 변수 충돌이라는 것을 로그를 한참 거슬러 올라가야 알 수 있다.

## 2. 현재 상태 조사 (완료)

`grep -n "FLUTTER_ROOT"`로 레포 전체를 검색한 결과, 영향받는 곳은 정확히 2개 파일·17곳이며 이슈 본문이 밝힌 카운트(8+9)와 정확히 일치한다.

### `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` (8곳)

| 줄 | 내용 |
|---|---|
| 50 | `FLUTTER_ROOT: "."  # @wizard auto:flutter-root` (env 정의) |
| 60 | `working-directory: ${{ env.FLUTTER_ROOT }}` (prepare-build job) |
| 193 | `working-directory: ${{ env.FLUTTER_ROOT }}` (build-android job) |
| 517 | `path: ${{ env.FLUTTER_ROOT }}/build/app/outputs/bundle/release/app-release.aab` (AAB 업로드) |
| 526 | `working-directory: ${{ env.FLUTTER_ROOT }}` (deploy-playstore job) |
| 547 | `path: ${{ env.FLUTTER_ROOT }}/build/app/outputs/bundle/release/` (AAB 다운로드) |
| 563 | `working-directory: ${{ env.FLUTTER_ROOT }}/android` (Fastlane 설치 스텝) |
| 664 | 한글 주석: `...working-directory가 FLUTTER_ROOT이므로 절대경로 사용` |

### `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` (9곳)

| 줄 | 내용 |
|---|---|
| 78 | `FLUTTER_ROOT: "."  # @wizard auto:flutter-root` (env 정의) |
| 105 | `working-directory: ${{ env.FLUTTER_ROOT }}` (prepare-build job) |
| 235 | `working-directory: ${{ env.FLUTTER_ROOT }}` (build-ios job) |
| 372 | `path: ${{ env.FLUTTER_ROOT }}/ios/build/ipa/*.ipa` (IPA 업로드) |
| 383 | `working-directory: ${{ env.FLUTTER_ROOT }}` (deploy-testflight job) |
| 402 | `path: ${{ env.FLUTTER_ROOT }}/ios/build/ipa/` (IPA 다운로드) |
| 421 | `working-directory: ${{ env.FLUTTER_ROOT }}/ios` (Fastlane 설치 스텝) |
| 435 | **셸 레벨** `${FLUTTER_ROOT}` — `IPA_PATH=$(find "$GITHUB_WORKSPACE/${FLUTTER_ROOT}/ios/build/ipa" ...)`. `${{ env.FLUTTER_ROOT }}` GH Actions 표현식이 아니라 `run:` 블록 안 bash 변수 참조라, 단순 `${{ env.FLUTTER_ROOT }}` 문자열 검색으로는 놓치기 쉬운 지점 |
| 442 | 한글 주석: `...working-directory가 FLUTTER_ROOT이므로 절대경로 사용)` |

그 외 `payload/workflows/flutter/`의 나머지 6개 파일(`ANDROID-FIREBASE-CICD`, `ANDROID-SELFHOSTED-CICD`, `ANDROID-TEST-APK`, `CI`, `IOS-TEST-TESTFLIGHT`, `SUH-LAB-APP-BUILD-TRIGGER`)은 `env.FLUTTER_VERSION`만 참조할 뿐 `FLUTTER_ROOT`를 정의/참조하지 않는다 — 확인 완료, 영향 없음.

### 마법사 엔진 호환성 확인

`# @wizard auto:flutter-root` 마커 주석은 `src/core/wizard-env.js`의 `resolveToken(name, ...)`이 리졸버를 **이름으로** 찾는 구조다(`KEY_RE = /^(\s*)([A-Z_]+):/`가 콜론 앞 키를 라인에서 동적으로 추출, 마커의 `flutter-root`는 `resolvers["flutter-root"]`를 가리키는 별개의 리졸버 이름). 즉 YAML 키 텍스트(`FLUTTER_ROOT` → `FLUTTER_PROJECT_DIR`)와 마커의 리졸버 이름(`flutter-root`)은 완전히 분리되어 있어, 키만 바꿔도 `src/core/detect-fs.js`의 `"flutter-root": () => paths.get("flutter") || "."` 리졸버는 그대로 동작한다. **`src/` 변경 불필요, 확인 완료.**

레포 전체(`docs/`, `CONTRIBUTING.md`, `tests/`, `.github/workflows/`)에서 `FLUTTER_ROOT`/`flutter-root` 문자열을 재검색해 위 17곳 + 마커 주석 외 참조가 없음을 확인했다. `.github/workflows/`(이 레포 자신의 dogfooding 산출물)에는 Flutter 관련 워크플로우가 존재하지 않는다(확인됨, `#42` 스펙에서도 동일하게 확인) — 수동 동기화 대상이 없다.

### upload-artifact 스텝 전수 조사

두 파일 각각 `upload-artifact` 스텝이 3곳씩, 총 6곳 있다. 현재 어느 곳도 `if-no-files-found`를 지정하지 않아 기본값(`warn`)이 적용된다.

| 파일 | 스텝 이름 | `path:` |
|---|---|---|
| ANDROID-PLAYSTORE-CICD | Upload release notes | `final_release_notes.txt` |
| ANDROID-PLAYSTORE-CICD | Upload project files | `pubspec.yaml` / `lib/` / `assets/` |
| ANDROID-PLAYSTORE-CICD | Upload AAB artifact | `${{ env.FLUTTER_ROOT }}/build/.../app-release.aab` |
| IOS-TESTFLIGHT | Upload release notes | `final_release_notes.txt` |
| IOS-TESTFLIGHT | Upload project files | `${{ env.ENV_FILE_PATH }}` / `ios/Flutter/Secrets.xcconfig` / `pubspec.yaml` / `lib/` / `assets/` |
| IOS-TESTFLIGHT | Upload IPA artifact | `${{ env.FLUTTER_ROOT }}/ios/build/ipa/*.ipa` |

`download-artifact`는 이미 기본 동작이 "찾지 못하면 실패"이므로(이슈의 두 번째 에러 로그가 이 기본 동작을 보여준다) 이번 변경 대상이 아니다.

## 3. 목표 / 비목표

**목표**:
1. 두 파일의 `FLUTTER_ROOT` 17곳을 이슈가 제안한 `FLUTTER_PROJECT_DIR`로 전부 개명해 `subosito/flutter-action`과의 이름 충돌을 제거한다.
2. 두 파일의 `upload-artifact` 스텝 6곳 전체에 `if-no-files-found: error`를 추가해, 경로가 비게 되는 이 버그 클래스가 빌드 잡 단계에서 즉시 드러나게 한다(현재는 warning만 내고 다음 잡에서야 실패해 원인 파악이 어렵다).
3. `tests/node/payload-yaml.test.js`에 `#38`/`#39`/`#40`/`#42`와 동일한 패턴의 회귀 테스트를 추가해, 향후 `FLUTTER_ROOT` 재도입이나 `if-no-files-found` 누락을 자동으로 잡아낸다.

**비목표**:
- "Upload project files" 스텝의 `path:`(`pubspec.yaml`/`lib/`/`assets/`, iOS는 `ios/Flutter/Secrets.xcconfig` 포함)는 프로젝트 디렉토리 변수 접두사가 없어 모노레포 설정(`FLUTTER_PROJECT_DIR != "."`)에서 잘못된 위치를 참조할 수 있는 **별개의 기존 버그**다. 이슈 #50이 보고한 증상(FLUTTER_ROOT 이름 충돌)과 무관하고, 이슈 원안에도 없으므로 이번 작업에서 고치지 않는다 — PR 설명/코멘트에서 향후 별도 이슈로 제보할 가치가 있다고만 언급한다.
- `download-artifact` 스텝은 이미 기본 동작이 안전(파일 없으면 실패)하므로 건드리지 않는다.
- `src/core/wizard-env.js`, `src/core/detect-fs.js` 등 마법사 엔진 소스는 수정하지 않는다(2절에서 확인했듯 리졸버 이름과 YAML 키가 분리되어 있어 변경 불필요).
- 이슈 #37에 묶인 다른 개별 이슈(#38~#42, 이미 해결됨)는 이 스펙의 범위 밖.
- `.github/workflows/` 도그푸딩 동기화 — 대상 파일 없음(확인 완료).

## 4. 설계

### 4.1 변수명 변경

두 파일에서 `FLUTTER_ROOT` 문자열 전체(대소문자 정확히 일치, 2절 표의 17곳)를 `FLUTTER_PROJECT_DIR`로 치환한다. 이슈가 제안한 이름을 그대로 채택한다(이슈 원안 그대로 채택 원칙).

- env 정의 줄의 `# @wizard auto:flutter-root` 마커 주석은 **변경하지 않는다** — 리졸버 이름은 YAML 키와 무관하다(2절에서 확인).
- 435번째 줄의 셸 변수 `${FLUTTER_ROOT}`도 `${FLUTTER_PROJECT_DIR}`로 함께 바꾼다 — `env:` 블록의 값은 `run:` 스텝에서 동일 이름의 셸 환경변수로도 노출되므로, GH Actions 표현식(`${{ env.X }}`)과 셸 변수(`$X`/`${X}`) 양쪽 다 새 이름을 써야 한다.
- 442/664번째 줄의 한글 주석도 변수명 언급을 `FLUTTER_PROJECT_DIR`로 갱신한다 — 이슈 본문이 "두 파일에서 17곳을 일괄 개명"이라 명시한 카운트에 이 주석 2곳이 포함되어 있다(2절 표 확인).

기각한 대안 (참고용, 채택하지 않음):
- `flutter-action` 스텝을 env 정의보다 먼저 배치 — 효과 없음. GH Actions는 `env:` 블록 위치와 무관하게 `$GITHUB_ENV` 기록을 이후 모든 스텝에 적용하므로 순서를 바꿔도 SDK 경로가 이긴다.
- `${{ github.workspace }}`로 하드코딩 — 이슈가 명시했듯 모노레포(`project_paths`) 지원이 깨진다.

### 4.2 `if-no-files-found: error` 추가

두 파일의 `upload-artifact` 스텝 6곳(3절 표) 전체에 `retention-days:` 다음 줄로 `if-no-files-found: error`를 추가한다. 예:

```yaml
      - name: Upload AAB artifact
        uses: actions/upload-artifact@v7
        with:
          name: android-aab
          path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab
          retention-days: 1
          if-no-files-found: error
```

FLUTTER_ROOT와 무관한 나머지 4곳(release-notes ×2, project-files ×2)에도 동일하게 추가한다 — 사용자가 "일관성을 위해 6곳 전체에 추가"를 선택했다(브레인스토밍 확정 사항). `if-no-files-found: error`는 경로가 비어 있는 모든 원인(변수 충돌뿐 아니라 스텝 실패로 파일이 애초에 안 만들어진 경우 등)에 대해 동일하게 조기 실패를 유도하므로, 범위를 넓혀도 부작용이 없다.

### 4.3 테스트 계획

`tests/node/payload-yaml.test.js`가 이미 갖고 있는 파일별 문자열 단언 패턴(`#38`~`#42` 절)을 따라 이슈 #50 전용 테스트 블록을 추가한다. 두 파일에 대해 각각(또는 공용 헬퍼로 두 파일을 순회):

```js
test("<파일명>: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명되어 subosito/flutter-action과 이름 충돌하지 않는다 (#50)", () => {
  const body = readFileSync(<path>, "utf8");
  assert.ok(!body.includes("FLUTTER_ROOT"), "FLUTTER_ROOT가 남아있으면 subosito/flutter-action의 SDK 경로 export와 충돌한다");
  assert.ok(/^\s*FLUTTER_PROJECT_DIR:\s*"\."/m.test(body), "FLUTTER_PROJECT_DIR env 정의가 있어야 한다");
});

test("<파일명>: upload-artifact 스텝 전부가 if-no-files-found: error를 지정한다 (#50)", () => {
  const body = readFileSync(<path>, "utf8");
  const uploadBlocks = body.split(/(?=- name: Upload)/).filter((b) => b.includes("uses: actions/upload-artifact"));
  assert.ok(uploadBlocks.length > 0, "upload-artifact 스텝을 찾지 못했습니다");
  for (const block of uploadBlocks) {
    assert.ok(block.includes("if-no-files-found: error"), `누락된 스텝:\n${block.slice(0, 120)}`);
  }
});
```

정확한 정규식/블록 분리 방식은 `writing-plans` 단계에서 파일의 실제 텍스트를 보며 확정한다(위 코드는 방향성 예시). 두 테스트 모두:
- 수정 전에는 반드시 FAIL한다(`FLUTTER_ROOT`가 아직 존재, `if-no-files-found`가 아직 없음).
- 수정 후 PASS한다.
- 이후 누군가 `FLUTTER_ROOT`를 재도입하거나 신규 `upload-artifact` 스텝에서 `if-no-files-found`를 빠뜨리면 다시 회귀를 잡아낸다.

`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`의 기존 build_runner 회귀 테스트(`assertBuildRunnerGuardFollowsEveryPubGet`, `#42`)는 이번 변경과 무관한 삽입 지점을 검사하므로 영향받지 않는다 — 회귀 없음을 구현 단계에서 `npm test`로 재확인한다.

## 5. 위험 및 롤백

- 위험은 낮다: 템플릿 파일 2개에 대한 리터럴 문자열 치환(변수명) + 각 파일 6곳에 한 줄 추가(`if-no-files-found`) + 텍스트 단언 테스트 추가뿐이며, 런타임 로직(`src/`, `bin/`)에는 영향이 없다(2절에서 확인).
- 가장 흔한 실수 지점은 435번째 줄의 셸 변수(`${FLUTTER_ROOT}`)를 놓치는 것이다 — `${{ env.FLUTTER_ROOT }}` 패턴만 찾는 단순 검색으로는 걸리지 않으므로, 구현 단계에서 리터럴 문자열 `FLUTTER_ROOT`(대소문자 정확 일치) 기준으로 전수 치환하고 각 파일에 문자열이 0개 남았는지 재검색으로 확인한다.
- 기존 `#40` 블록 스칼라 이탈 회귀 가드(`findBlockScalarIndentationViolations`)가 전체 payload 워크플로우에 이미 실행되므로, `if-no-files-found` 추가로 들여쓰기가 깨지면 별도 테스트 없이도 기존 스위트가 잡아낸다.
- 이미 이 워크플로우로 설치된 기존 사용자 프로젝트는 이번 수정으로 자동 갱신되지 않는다(payload는 설치/업그레이드 시점에만 반영됨) — 이는 이 프로젝트의 기존 배포 모델이며 이 스펙의 범위 밖이다.
- 롤백은 단순 revert로 충분하다(파일별 독립 커밋 권장 — 플랜 문서에서 파일당 1커밋으로 분리 여부를 확정한다).

## 6. Git 워크플로우

이슈 #50은 #37 트래킹 클러스터에 속한다(이슈 본문 하단 "트래킹: #37"). `#38`~`#42` 실적 관행에 따라 `main`에서 브랜치를 따고 `main`으로 PR을 연다 — `CONTRIBUTING.md`가 명시한 기본값(`develop` 기준 브랜치·PR)은 이 클러스터에는 적용되지 않는 것이 실제 관행이다. 커밋 메시지는 이 레포의 `CLAUDE.md` 규칙에 따라 한국어로 작성한다(Conventional Commits 타입 접두사는 영어 유지).
