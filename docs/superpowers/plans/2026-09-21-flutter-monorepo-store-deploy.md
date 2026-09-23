# Flutter 모노레포 경로 필터·CI gate·dart-define·스토어 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **이 플랜은 아래 "실행 제약"이 우선한다.**

**Goal:** 모노레포에서 해당 프로젝트 폴더가 바뀔 때만 배포·CI가 돌도록 경로 필터와 required-check 안전한 CI gate를 전 타입에 도입하고, Flutter의 루트 경로·환경변수(`--dart-define-from-file`)·스토어 배포(fastlane) 파이프라인을 정비해 마법사에서 선택·수정할 수 있게 한다.

**Architecture:** (1) 신규 모듈 `src/core/flutter-options.js`가 옵션(환경변수 모드·스토어 대상·배포 모드)의 값·해석·필터·정리를 한곳에서 담당한다. (2) 옵션은 `version.yml`의 `metadata.template.options`에 저장되고(배포 방식 `deploy_style` 패턴), 워크플로우에는 기존 `@wizard auto:` 토큰과 신규 `fallback` 마커로 주입된다. (3) 복사 엔진은 기존 배포 방식 필터 옆에 스토어 필터와 정리를 추가하고, `payload/flutter-app/`의 앱 파일(Fastfile·ExportOptions.plist)은 "없을 때만 생성"으로 설치한다. (4) 워크플로우 YAML은 파일별로 경로 앵커·`changes`/`ci-gate`·`FLUTTER_PROJECT_DIR`·환경변수 모드를 적용한다.

**Tech Stack:** Node ≥20 (`node --test`, ESM, 의존성 0), GitHub Actions YAML(payload 템플릿), `dorny/paths-filter@v4`, fastlane(Ruby DSL), actionlint(로컬 검증 전용, 의존성 아님), Flutter 3.47.5(로컬 실측용).

**Spec:** GitHub 이슈 #131 (https://github.com/Twin-Fang/project-auto-wizard/issues/131) — 본문이 승인된 설계다. 초안: `.issue/#20260921_002_기능개선_Flutter_모노레포_필터_dart_define_스토어_배포_템플릿.md`(gitignore 대상). 이 플랜은 이슈 본문의 "결정 사항"을 그대로 구현한다.

## 실행 제약 (모든 Task에 적용)

- 작업 위치는 현재 브랜치 `20260921_#131_모노레포_경로_필터_CI_gate_dart_define_환경변수_스토어_배포_fastlane_템플릿과_선택지_추가`다. **worktree를 만들지 않는다.**
- **서브에이전트는 커밋, 스테이징(`git add`), `git mv`를 하지 않는다.** 파일 이동은 일반 `mv`를 쓴다. 각 Task 끝의 검증 단계까지만 수행하고, 커밋은 모든 구현·검토가 끝난 뒤 `/prp-commit`이 책임별로 나눠 수행한다.
- git의 force 계열 옵션(`--force`, `-f`, `reset --hard`, `clean -f`, `branch -D`, `--no-verify` 등)을 절대 쓰지 않는다. `.gitignore` 대상 파일(`.issue/` 등)은 강제로 추적시키지 않는다.
- 이슈 #131에 없는 변경을 추가하지 않는다(문서화·리팩터링·인접 코드 개선 금지). 새 npm 의존성을 추가하지 않는다.
- 일회성 검증 스크립트는 스크래치패드에만 만들고 저장소에 남기지 않는다: `SP=/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/a405647a-5c94-4250-99d2-7c3a4a0061dc/scratchpad`
- 저장소 루트: `/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard` (이하 `ROOT`). 모든 명령은 `cd ROOT` 후 실행한다.
- 각 Task의 테스트는 해당 파일만 실행한다(`node --test <파일>`). 전체 `npm test`는 Task 27에서 실행한다. 이 레포의 `npm run test:node`는 `--test-concurrency=1`이다.
- 초안 단계의 `git add`/`git commit` 스텝은 이 플랜에서 모두 제거되었다. 어떤 Task에 커밋 명령이 남아 있으면 무시한다.
- 커밋 메시지(나중에 `/prp-commit`이 작성)는 한국어이며 타입 접두사만 영어다.

## Global Constraints

- 환경변수 모드는 `dart-define`(신규 설치 기본)과 `dotenv` 두 개뿐이다. `both`는 만들지 않는다. 이미 설치된 프로젝트(`version.yml`이 있고 `env_mode` 저장값이 없음)는 기존 동작 보존을 위해 `dotenv`를 유지하고(대화형 재실행의 목록 초기 선택도 `dotenv`), 신규 설치는 대화형·비대화형 모두 `dart-define`이 기본이다. (이슈 본문의 "비대화형 실행은 dotenv 유지" 문구는 사용자가 확정한 답 "기존 설치는 dotenv 유지, 신규 설치만 dart-define"과 어긋나므로 후자를 따른다.)
- `dart-define` 모드: `ENV_FILE`(없으면 `ENV`) 시크릿을 프로젝트 밖 임시 경로(`$RUNNER_TEMP`)에 쓰고 `--dart-define-from-file`로 전달한다. 프로젝트 루트에는 `.env`를 만들지 않는다. `dotenv` 모드: 지금처럼 Flutter 루트에 `.env`를 만든 뒤 `build_runner`가 실행되는 순서를 유지한다.
- 저장 키(`metadata.template.options`): `env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`. CLI 플래그: `--flutter-env-mode dart-define|dotenv`, `--flutter-store android,ios,none`, `--android-deploy-mode`, `--ios-deploy-mode`(값 `store_only|store_prepare|store_submit`). 배포 모드 기본은 `store_only`.
- 스토어 대상 묶음: Android = `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` + `android/fastlane/Fastfile.playstore`. iOS = `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` + `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` + `ios/fastlane/Fastfile` + `ios/ExportOptions.plist`. `FIREBASE`, `SELFHOSTED`, `TEST-APK`, `APP-BUILD-TRIGGER`, `CI`는 항상 설치한다. `context.flutterStore === null`은 현행 동작(둘 다 설치).
- 스토어 대상 해제 시 정리 규칙은 기존 배포 방식과 같다: 미수정 워크플로우는 삭제, 수정본은 `.bak`. Fastfile·ExportOptions.plist는 사용자 소유라 삭제하지 않는다. 앱 파일은 "없을 때만 생성"이며 uninstall이 건드리지 않는다.
- 경로 필터는 `<경로>/**` 하나만(Spring 방식). main push 앵커 대상은 Flutter 4종(PLAYSTORE, IOS-TESTFLIGHT, SELFHOSTED, FIREBASE)과 Spring publish 2종. CI 6종(Flutter, Go, Next, Python, React, Spring NEXUS-CI)은 job 단위 필터(`changes` + `ci-gate`). CICD에는 job 단위 필터를 쓰지 않는다.
- 판별은 `dorny/paths-filter@v4`(버전 태그, SHA 고정 아님 — 이 레포 관례). PR에는 `pull-requests: read` 권한. `ci-gate` 판정: `success`/`skipped`만이면 통과, `failure`/`cancelled`가 하나라도 있으면 실패, `if: always()`. `workflow_dispatch`는 항상 실행한다(판별 스텝은 `if: github.event_name != 'workflow_dispatch'`로 건너뛰고, 다운스트림 job의 `if`가 `workflow_dispatch`를 참으로 처리한다 — dorny/paths-filter의 dispatch 동작을 신뢰하지 않기 위함).
- fastlane은 스토어 배포 전용(PLAYSTORE, IOS-TESTFLIGHT, IOS-TEST-TESTFLIGHT). SELFHOSTED·TEST-APK에서 Ruby 설정·fastlane 설치·`fastlane build`를 삭제하고 `flutter build apk --release`를 직접 실행한다. Android `build` lane 템플릿은 만들지 않는다.
- Gemfile: 스토어 배포 워크플로우 3곳에서 해당 디렉토리(`android`/`ios`)의 Gemfile에 `fastlane`이 있으면 그것을 쓰고, 없으면 기존처럼 생성(`multi_json` 우회 포함). Gemfile 템플릿은 배포하지 않는다.
- Play Store 워크플로우의 새 변수는 `ANDROID_PACKAGE_NAME`(`secrets.X || vars.X`)이고 fastlane에는 `PACKAGE_NAME`으로 export한다.
- breaking-changes 고지 4건은 `severity: warning`, 키 `"0.10.1"`.
- 새 마법사 질문은 Flutter 타입이 포함된 경우에만 묻고, 저장값이 있으면 재질문하지 않는다. `store_submit` 선택 시 경고 한 줄. "수정하기" 메뉴에 3개 항목(환경변수 방식, 스토어 배포 대상, 배포 모드).
- `doctor`는 스토어 시크릿 등록 검사를 하지 않는다. `status`/`doctor`/`dry-run` 확장은 이 플랜의 Task 12~14 범위만.

## 확인된 사실 (구현이 의존한다)

- **Flutter `.env` 파서**(Flutter 3.47.5, `packages/flutter_tools/lib/src/runner/flutter_command.dart`의 `DotEnvRegex`, `extractDartDefineConfigJsonMap`): 파일 내용이 `{`로 시작하면 JSON으로, 아니면 `.env`로 해석한다. `.env`는 빈 줄과 `#` 시작 줄을 무시하고, 각 줄이 `KEY=값`(키는 `[a-zA-Z_][a-zA-Z0-9_]*`)이어야 하며 그렇지 않으면 `Unable to parse file … Invalid property line`으로 종료한다. 값은 `"…"`, `'…'`, `` `…` `` 로 감싸면 따옴표가 벗겨지고 뒤의 `# 주석`이 제거된다. 따옴표 없는 값은 공백과 `#` 앞까지이며 값 안의 `=`는 허용된다. **`export KEY=값` 줄은 지원하지 않고(오류), 멀티라인(`"""`) 값은 `Multi-line value is not supported` 오류다.** 모든 값은 문자열이다. README에 이 범위를 명시한다.
- **GitHub 문서**: 경로·브랜치 필터로 워크플로우가 건너뛰어지면 체크가 Pending으로 남고, job 단위 `if`로 건너뛴 job은 Success로 보고된다. "Path filters are not evaluated for pushes of tags."
- **워크플로우 계약**: PLAYSTORE는 `AAB_PATH`·`GOOGLE_PLAY_JSON_KEY`·`VERSION_NAME`·`VERSION_CODE`·`DEPLOY_MODE`만 fastlane에 넘기고(패키지명 없음), IOS-TESTFLIGHT는 `DEPLOY_MODE`와 `APP_IDENTIFIER` 등을 넘긴다. 모드별 실제 동작은 Fastfile이 결정한다.
- **알려진 한계 — `dorny/paths-filter`의 push `base` 기본값(fable 검토에서 발견, 해결은 후속)**: `changes` job의 필터 스텝에 `base:`를 지정하지 않으면, push 이벤트에서는 레포의 기본 브랜치(main) 대비 merge-base 기준으로 변경을 판단한다(action README: "against the merge-base with the configured base branch or the default branch"). 그래서 `develop` push에서 그 프로젝트 경로가 과거 한 번이라도 바뀐 적이 있으면 매번 "변경 있음"으로 판정될 수 있다. 방향은 안전하다(잘못 건너뛰지 않고, 과잉 실행만 함) — required check가 막히는 문제는 아니다. 정확히 하려면 필터 스텝에 `base: ${{ github.ref_name }}`를 추가해 "직전 push와 비교"로 바꾸는 안이 있으나, PR 이벤트에는 이 옵션이 무시되므로 부작용은 없다. 이번 구현 범위에서는 6개 CI(Task 16·17·18)에 이를 적용하지 않고, PR 이후 테스트 레포에서 실제 동작을 확인한 뒤 필요하면 후속 이슈로 넣는다.

## File Structure

| 구분 | 파일 | 책임 |
|---|---|---|
| Create | `src/core/flutter-options.js` | 옵션 값·해석·스토어 필터·정리 (Task 1) |
| Create | `src/core/copy/flutter-app.js` | 스토어 앱 파일 복사·계획(없을 때만 생성) (Task 8) |
| Create | `payload/flutter-app/android/fastlane/Fastfile.playstore` | Play `deploy_internal` lane (Task 25) |
| Create | `payload/flutter-app/ios/fastlane/Fastfile`, `payload/flutter-app/ios/ExportOptions.plist` | iOS `deploy`·`upload_testflight` lane, 플레이스홀더 plist (Task 26) |
| Create | `tests/node/flutter-options.test.js`, `ci-gate-payload.test.js`, `flutter-workflows-payload.test.js`, `flutter-app-templates.test.js` | 신규 테스트 |
| Create | `src/commands/interactive-flutter.js`, `src/core/installed-stores.js` | 마법사의 Flutter 질문·수정 로직, 설치된 스토어 워크플로우로 플랫폼 추론 (Task 11) |
| Create | 신규 테스트 다수 | Task별로 명시(`flutter-options-resolve`, `flutter-options-cli`, `flutter-store-filter`, `flutter-app-copy`, `flutter-full-install`, `prompts-flutter`, `interactive-flutter`, `installed-stores`, `readme-flutter-docs` 등) |
| Modify | `src/context.js`, `src/core/wizard-env.js`, `src/core/detect-fs.js`, `src/core/version-yml.js`, `payload/version.yml.template`, `src/cli/args.js`, `src/cli/help.js`, `src/index.js` | 옵션 저장·토큰·CLI·비대화형 결정 (Task 2~6) |
| Modify | `src/core/copy/workflows.js`, `src/ui/env-plan.js`, `src/commands/full.js` | 스토어 필터·ask 수집 필터·정리·앱 파일 연동 (Task 7, 7b, 9) |
| Modify | `src/ui/prompts.js`, `src/commands/interactive.js`, `src/commands/status.js`, `src/commands/doctor.js`, `src/commands/dry-run.js`, `src/ui/summary.js`, `payload/config/breaking-changes.json`, `README.md` | 마법사·가시성·고지·문서 (Task 10~15) |
| Modify | `payload/workflows/{go,next,python,react}/*-CI.yaml`, `payload/workflows/spring/nexus/*.yml` | CI gate·publish 앵커 (Task 16~17) |
| Modify | `payload/workflows/flutter/*.yaml` 7개 | 앵커·gate·루트·환경변수·fastlane 정리 (Task 18~24) |
| Modify | `src/core/breaking.js` | `collectBreaking`이 버전 키당 배열(여러 고지)을 받도록 확장 (Task 15) |
| Modify | `tests/node/payload-example-values.test.js` | `fallback` 마커 줄을 ask 값 겹따옴표 검사에서 제외하는 1줄 예외 (Task 22) |
| Modify | 기존 테스트 `tests/node/{wizard-env,version-yml,args-validation,status,doctor,dry-run,summary-output,breaking-check,plan-workflows}.test.js` 등 | 회귀·확장 |

## 실행 순서

**번호 순서가 아니라 아래 순서로 실행한다.** Task 9(`runFull` 통합)는 실제 `payload/flutter-app/*`(Task 25~26)가 있어야 기존 e2e 케이스가 깨지지 않기 때문이다.

1. Task 1 → 2 → 3 → 4 → 5 → 6 (옵션 코어)
2. Task 7 → 7b → 8 (복사 엔진, 스토어 필터, 앱 파일 복사)
3. Task 25 → 26 (Fastfile·plist 템플릿)
4. Task 9 (`runFull` 연동)
5. Task 10 → 11 → 12 → 13 → 14 → 15 (마법사·가시성·고지·문서)
6. Task 16 → 17 (비Flutter 워크플로우)
7. Task 18 → 19 → 20 → 21 → 22 → 23 → 24 (Flutter 워크플로우)
8. Task 27 (전체 검증)

Task 22(PLAYSTORE)·23·24는 Task 25~26의 Fastfile이 읽는 환경변수 이름(계약 §8)과 일치해야 한다.

---

### Task 1: `flutter-options.js` — 상수·스토어 목록 파싱·필터·정리·앱 파일 목록

**Files:**
- Create: `src/core/flutter-options.js`
- Test: `tests/node/flutter-options.test.js`

**Interfaces:**
- Consumes: `sha256(text: string): string` from `src/core/baseline.js` (기존).
- Produces (`src/core/flutter-options.js`, 이후 Task·다른 초안이 소비):
  - `ENV_MODES = ["dart-define","dotenv"]`, `DEFAULT_ENV_MODE = "dart-define"`, `LEGACY_ENV_MODE = "dotenv"`
  - `STORE_PLATFORMS = ["android","ios"]`, `DEPLOY_MODES = ["store_only","store_prepare","store_submit"]`, `DEFAULT_DEPLOY_MODE = "store_only"`, `NO_STORE = "none"`
  - `isEnvMode(v): boolean`, `isDeployMode(v): boolean`
  - `parseStoreList(csv): string[] | null` — `"android,ios"`/`"android"`/`"none"`/`""` → 배열(`none`·`""`은 `[]`, 항상 `STORE_PLATFORMS` 순서·중복 제거), 잘못된 토큰이거나 문자열이 아니면 `null`
  - `formatStoreList(stores: string[]): string` — 빈 배열 → `"none"`
  - `STORE_WORKFLOWS`, `isStoreWorkflow(filename): boolean`, `storeWorkflowFilter(stores: string[]|null): (filename) => boolean`
  - `cleanupDeselectedStoreWorkflows(workflowsDir, installedFilenames, stores, baseline): { removed: string[], backedUp: string[] }`
  - `STORE_APP_FILES`, `storeAppFilesFor(stores: string[]|null): string[]`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/flutter-options.test.js` 신규 생성

```js
// tests/node/flutter-options.test.js
// Flutter 옵션 (이슈 #131) — 스토어 배포 대상 선택·정리. deploy-style.test.js와 같은 구조의 검증.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ENV_MODES, DEFAULT_ENV_MODE, LEGACY_ENV_MODE, STORE_PLATFORMS, DEPLOY_MODES, DEFAULT_DEPLOY_MODE, NO_STORE,
  isEnvMode, isDeployMode, parseStoreList, formatStoreList,
  STORE_WORKFLOWS, isStoreWorkflow, storeWorkflowFilter, cleanupDeselectedStoreWorkflows,
  STORE_APP_FILES, storeAppFilesFor,
} from "../../src/core/flutter-options.js";
import { sha256 } from "../../src/core/baseline.js";

const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const IOS_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const IOS_TEST_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
const CI = "PROJECT-FLUTTER-CI.yaml";
const SELFHOSTED = "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml";

test("상수: 기본값과 기존 설치 보존값이 계약대로다", () => {
  assert.deepStrictEqual(ENV_MODES, ["dart-define", "dotenv"]);
  assert.strictEqual(DEFAULT_ENV_MODE, "dart-define");
  assert.strictEqual(LEGACY_ENV_MODE, "dotenv");
  assert.deepStrictEqual(STORE_PLATFORMS, ["android", "ios"]);
  assert.deepStrictEqual(DEPLOY_MODES, ["store_only", "store_prepare", "store_submit"]);
  assert.strictEqual(DEFAULT_DEPLOY_MODE, "store_only");
  assert.strictEqual(NO_STORE, "none");
});

test("isEnvMode / isDeployMode: 목록에 있는 값만 참이다", () => {
  assert.ok(isEnvMode("dart-define") && isEnvMode("dotenv"));
  assert.ok(!isEnvMode("both") && !isEnvMode("") && !isEnvMode(undefined));
  assert.ok(isDeployMode("store_only") && isDeployMode("store_prepare") && isDeployMode("store_submit"));
  assert.ok(!isDeployMode("publish") && !isDeployMode("") && !isDeployMode(null));
});

test("parseStoreList: 정상 입력은 STORE_PLATFORMS 순서의 배열로 정규화한다", () => {
  assert.deepStrictEqual(parseStoreList("android,ios"), ["android", "ios"]);
  assert.deepStrictEqual(parseStoreList("ios,android"), ["android", "ios"]);
  assert.deepStrictEqual(parseStoreList(" ios , ios "), ["ios"]);
  assert.deepStrictEqual(parseStoreList("android"), ["android"]);
});

test("parseStoreList: 'none'과 빈 문자열은 빈 배열이다", () => {
  assert.deepStrictEqual(parseStoreList("none"), []);
  assert.deepStrictEqual(parseStoreList(""), []);
});

test("parseStoreList: 잘못된 토큰·none 혼용·문자열이 아닌 값은 null이다", () => {
  assert.strictEqual(parseStoreList("windows"), null);
  assert.strictEqual(parseStoreList("android,windows"), null);
  assert.strictEqual(parseStoreList("android,none"), null);
  assert.strictEqual(parseStoreList(null), null);
  assert.strictEqual(parseStoreList(undefined), null);
});

test("formatStoreList: 직렬화하고 빈 배열은 'none'이며 parseStoreList와 왕복한다", () => {
  assert.strictEqual(formatStoreList(["android", "ios"]), "android,ios");
  assert.strictEqual(formatStoreList(["ios", "android"]), "android,ios");
  assert.strictEqual(formatStoreList(["ios"]), "ios");
  assert.strictEqual(formatStoreList([]), "none");
  for (const stores of [[], ["android"], ["ios"], ["android", "ios"]]) {
    assert.deepStrictEqual(parseStoreList(formatStoreList(stores)), stores);
  }
});

test("STORE_WORKFLOWS / isStoreWorkflow: 스토어 묶음 파일만 참이다", () => {
  assert.deepStrictEqual(STORE_WORKFLOWS.android, [PLAYSTORE]);
  assert.deepStrictEqual(STORE_WORKFLOWS.ios, [IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT]);
  assert.ok(isStoreWorkflow(PLAYSTORE) && isStoreWorkflow(IOS_TESTFLIGHT) && isStoreWorkflow(IOS_TEST_TESTFLIGHT));
  assert.ok(!isStoreWorkflow(CI) && !isStoreWorkflow(SELFHOSTED));
  assert.ok(!isStoreWorkflow("PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml"));
  assert.ok(!isStoreWorkflow("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("storeWorkflowFilter(null): 미결정이면 전부 통과한다 (현행 동작)", () => {
  const keep = storeWorkflowFilter(null);
  assert.ok(keep(PLAYSTORE) && keep(IOS_TESTFLIGHT) && keep(IOS_TEST_TESTFLIGHT) && keep(CI));
});

test("storeWorkflowFilter(['android']): Android 묶음만 통과, 스토어가 아닌 파일은 항상 통과", () => {
  const keep = storeWorkflowFilter(["android"]);
  assert.ok(keep(PLAYSTORE));
  assert.ok(!keep(IOS_TESTFLIGHT) && !keep(IOS_TEST_TESTFLIGHT));
  assert.ok(keep(CI) && keep(SELFHOSTED) && keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("storeWorkflowFilter(['ios']): iOS 묶음 두 개만 통과", () => {
  const keep = storeWorkflowFilter(["ios"]);
  assert.ok(keep(IOS_TESTFLIGHT) && keep(IOS_TEST_TESTFLIGHT));
  assert.ok(!keep(PLAYSTORE));
  assert.ok(keep(CI));
});

test("storeWorkflowFilter([]): 스토어 워크플로우를 전부 거르고 나머지는 통과", () => {
  const keep = storeWorkflowFilter([]);
  assert.ok(!keep(PLAYSTORE) && !keep(IOS_TESTFLIGHT) && !keep(IOS_TEST_TESTFLIGHT));
  assert.ok(keep(CI) && keep(SELFHOSTED));
});

test("STORE_APP_FILES / storeAppFilesFor: 선택된 플랫폼의 파일만, null이면 전부", () => {
  assert.deepStrictEqual(STORE_APP_FILES.android, ["android/fastlane/Fastfile.playstore"]);
  assert.deepStrictEqual(STORE_APP_FILES.ios, ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"]);
  assert.deepStrictEqual(storeAppFilesFor(null), [
    "android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist",
  ]);
  assert.deepStrictEqual(storeAppFilesFor(["ios", "android"]), [
    "android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist",
  ]);
  assert.deepStrictEqual(storeAppFilesFor(["android"]), ["android/fastlane/Fastfile.playstore"]);
  assert.deepStrictEqual(storeAppFilesFor(["ios"]), ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"]);
  assert.deepStrictEqual(storeAppFilesFor([]), []);
});

function withWorkflowsDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "paw-store-cleanup-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("cleanupDeselectedStoreWorkflows: 선택 해제된 스토어 워크플로우 — 미수정은 삭제, 수정본은 .bak", () => {
  withWorkflowsDir((dir) => {
    const pristine = "name: testflight\n";
    writeFileSync(join(dir, IOS_TESTFLIGHT), pristine);
    writeFileSync(join(dir, IOS_TEST_TESTFLIGHT), "name: edited by user\n");
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    writeFileSync(join(dir, CI), "name: ci\n");
    const baseline = { files: {
      [IOS_TESTFLIGHT]: { installed: sha256(pristine) },
      [IOS_TEST_TESTFLIGHT]: { installed: sha256("name: original\n") },
    } };

    const result = cleanupDeselectedStoreWorkflows(
      dir, [IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT, PLAYSTORE, CI], ["android"], baseline);

    assert.deepStrictEqual(result.removed, [IOS_TESTFLIGHT]);
    assert.deepStrictEqual(result.backedUp, [IOS_TEST_TESTFLIGHT]);
    assert.deepStrictEqual(readdirSync(dir).sort(), [CI, PLAYSTORE, `${IOS_TEST_TESTFLIGHT}.bak`].sort());
  });
});

test("cleanupDeselectedStoreWorkflows: baseline이 없으면 미수정 여부를 알 수 없으므로 전부 .bak으로 보존한다", () => {
  withWorkflowsDir((dir) => {
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE], ["ios"], null);
    assert.deepStrictEqual(result, { removed: [], backedUp: [PLAYSTORE] });
    assert.deepStrictEqual(readdirSync(dir), [`${PLAYSTORE}.bak`]);
  });
});

test("cleanupDeselectedStoreWorkflows: stores가 null이면 아무것도 정리하지 않는다", () => {
  withWorkflowsDir((dir) => {
    writeFileSync(join(dir, PLAYSTORE), "name: playstore\n");
    writeFileSync(join(dir, IOS_TESTFLIGHT), "name: testflight\n");
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE, IOS_TESTFLIGHT], null, { files: {} });
    assert.deepStrictEqual(result, { removed: [], backedUp: [] });
    assert.deepStrictEqual(readdirSync(dir).sort(), [IOS_TESTFLIGHT, PLAYSTORE].sort());
  });
});

test("cleanupDeselectedStoreWorkflows: 'none'([])이면 스토어 워크플로우 전체를 정리하고 CI는 남긴다", () => {
  withWorkflowsDir((dir) => {
    const contents = { [PLAYSTORE]: "a\n", [IOS_TESTFLIGHT]: "b\n", [IOS_TEST_TESTFLIGHT]: "c\n", [CI]: "d\n" };
    for (const [name, body] of Object.entries(contents)) writeFileSync(join(dir, name), body);
    const baseline = { files: Object.fromEntries(Object.entries(contents).map(([n, b]) => [n, { installed: sha256(b) }])) };
    const result = cleanupDeselectedStoreWorkflows(dir, Object.keys(contents), [], baseline);
    assert.deepStrictEqual(result.removed, [PLAYSTORE, IOS_TESTFLIGHT, IOS_TEST_TESTFLIGHT]);
    assert.deepStrictEqual(result.backedUp, []);
    assert.deepStrictEqual(readdirSync(dir), [CI]);
  });
});

test("cleanupDeselectedStoreWorkflows: 디스크에 없는 파일은 건너뛴다", () => {
  withWorkflowsDir((dir) => {
    const result = cleanupDeselectedStoreWorkflows(dir, [PLAYSTORE], ["ios"], { files: {} });
    assert.deepStrictEqual(result, { removed: [], backedUp: [] });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-options.test.js`
Expected: FAIL — `Cannot find module '.../src/core/flutter-options.js'` (`ERR_MODULE_NOT_FOUND`), 파일 전체가 로드 실패.

- [ ] **Step 3: 최소 구현** — `src/core/flutter-options.js` 신규 생성

```js
// Flutter 옵션 (이슈 #131) — 환경변수 방식·스토어 배포 대상·배포 모드의 단일 진실.
// 스토어 배포 대상은 deploy-style.js(배포 방식)와 같은 구조 — 값 목록, 파일 필터, 선택 해제 정리 — 를 따른다.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";

// 환경변수 주입 방식. dart-define은 --dart-define-from-file, dotenv는 flutter_dotenv/envied용 .env 생성.
// 둘을 동시에 쓰는 both는 만들지 않는다 — 환경변수를 두 곳에서 관리하게 되기 때문.
export const ENV_MODES = ["dart-define", "dotenv"];
export const DEFAULT_ENV_MODE = "dart-define"; // 신규 설치 기본
export const LEGACY_ENV_MODE = "dotenv";       // 기존 설치(version.yml 있음, 저장값 없음)가 조용히 깨지지 않도록 보존

export const STORE_PLATFORMS = ["android", "ios"];
export const DEPLOY_MODES = ["store_only", "store_prepare", "store_submit"];
export const DEFAULT_DEPLOY_MODE = "store_only";
export const NO_STORE = "none";

export const isEnvMode = (v) => ENV_MODES.includes(v);
export const isDeployMode = (v) => DEPLOY_MODES.includes(v);

// "android,ios" | "android" | "none" | "" → 배열. 항상 STORE_PLATFORMS 순서라 직렬화가 결정적이다.
// 알 수 없는 토큰이 하나라도 있거나 문자열이 아니면 null — 호출부가 "값 없음/잘못된 값"으로 처리한다.
export function parseStoreList(csv) {
  if (typeof csv !== "string") return null;
  const tokens = csv.split(",").map((t) => t.trim()).filter((t) => t !== "");
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === NO_STORE)) return [];
  if (!tokens.every((t) => STORE_PLATFORMS.includes(t))) return null;
  return STORE_PLATFORMS.filter((p) => tokens.includes(p));
}

// 저장용 직렬화 — 빈 배열은 빈 문자열이 아니라 "none"으로 적어 "선택 안 함"과 "값 없음"을 구분한다.
export function formatStoreList(stores) {
  const ordered = STORE_PLATFORMS.filter((p) => stores.includes(p));
  return ordered.length ? ordered.join(",") : NO_STORE;
}

// 플랫폼별 스토어 워크플로우 (payload/workflows/flutter/ 기준 파일명).
// FIREBASE·SELFHOSTED·TEST-APK·APP-BUILD-TRIGGER·CI는 스토어와 무관해 여기 넣지 않는다 — 항상 설치된다.
export const STORE_WORKFLOWS = {
  android: ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"],
  ios: ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"],
};

export const isStoreWorkflow = (filename) => Object.values(STORE_WORKFLOWS).flat().includes(filename);

// 파일 필터 — stores가 null이면 미결정이라 현행 동작(전부 설치)이다.
// 배열이면 스토어 워크플로우는 선택된 플랫폼 것만 통과하고, 그 외 파일은 항상 통과한다.
export function storeWorkflowFilter(stores) {
  if (stores === null || stores === undefined) return () => true;
  const allowed = new Set(STORE_PLATFORMS.filter((p) => stores.includes(p)).flatMap((p) => STORE_WORKFLOWS[p]));
  return (filename) => !isStoreWorkflow(filename) || allowed.has(filename);
}

// 선택 해제한 스토어 워크플로우 정리 — cleanupOtherDeployWorkflows(deploy-style.js)와 같은 규칙이다.
//   손대지 않은 것(baseline의 installed 해시와 동일) → 삭제
//   손댄 것                                          → .bak으로 옮긴다 (내용 보존, 트리거만 죽인다)
// 사용자 소유인 Fastfile·ExportOptions.plist는 여기서 다루지 않는다 (워크플로우 파일만 대상).
// 반환: { removed:[], backedUp:[] }
export function cleanupDeselectedStoreWorkflows(workflowsDir, installedFilenames, stores, baseline) {
  const keep = storeWorkflowFilter(stores);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isStoreWorkflow(filename) || keep(filename)) continue;
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = known && sha256(readFileSync(p, "utf8")) === known;
    if (untouched) {
      rmSync(p, { force: true });
      removed.push(filename);
    } else {
      renameSync(p, `${p}.bak`);
      backedUp.push(filename);
    }
  }
  return { removed, backedUp };
}

// 스토어 앱 파일 (payload/flutter-app/ 기준 상대경로) — 플랫폼별 묶음.
export const STORE_APP_FILES = {
  android: ["android/fastlane/Fastfile.playstore"],
  ios: ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"],
};

// 선택된 플랫폼의 앱 파일 목록. stores가 null이면 전부 (현행 동작 = 둘 다 설치).
export function storeAppFilesFor(stores) {
  const platforms = stores === null || stores === undefined
    ? STORE_PLATFORMS
    : STORE_PLATFORMS.filter((p) => stores.includes(p));
  return platforms.flatMap((p) => STORE_APP_FILES[p]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-options.test.js`
Expected: PASS (전 테스트 통과, fail 0).

---

### Task 2: `resolveFlutterOptions` 우선순위 해석 + context 필드

**Files:**
- Modify: `src/core/flutter-options.js` (파일 끝에 함수 추가)
- Modify: `src/context.js` (`createContext` 기본값 4개 추가)
- Test: `tests/node/flutter-options-resolve.test.js` (신규)

**Interfaces:**
- Consumes: Task 1의 `ENV_MODES`, `DEFAULT_ENV_MODE`, `LEGACY_ENV_MODE`, `DEFAULT_DEPLOY_MODE`, `isEnvMode`, `isDeployMode`, `parseStoreList`(모두 같은 파일 안). `existing`는 `parseExisting()`(`src/core/version-yml.js`) 결과이며 `existing.options.{envMode, flutterStore, androidDeployMode, iosDeployMode}`는 Task 4가 채운다(이 Task의 테스트는 손으로 만든 객체를 쓴다).
- Produces:
  - `resolveFlutterOptions({ cli, existing }): { envMode: string, stores: string[]|null, androidDeployMode: string, iosDeployMode: string }`
    - `cli`: `{ envMode: "", stores: null|string[], androidDeployMode: "", iosDeployMode: "" }` (생략 가능, 기본 `{}`)
    - `existing`: `parseExisting()` 결과 또는 `null`
  - `createContext()` 기본값: `envMode: ""`, `flutterStore: null`, `androidDeployMode: ""`, `iosDeployMode: ""`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/flutter-options-resolve.test.js` 신규 생성

```js
// tests/node/flutter-options-resolve.test.js
// Flutter 옵션 결정 우선순위 (이슈 #131): CLI > version.yml 저장값 > 기본값.
// 기본값은 신규 설치=dart-define, 기존 설치(version.yml 있음, 저장값 없음)=dotenv 보존.
import { test } from "node:test";
import assert from "node:assert";
import { resolveFlutterOptions } from "../../src/core/flutter-options.js";
import { createContext } from "../../src/context.js";

const NO_CLI = { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" };
// types 기본값은 "Flutter가 이미 설치된 프로젝트"를 모델링한다 — parseExisting()이 돌려주는
// 실제 모양(options 옆에 types 배열이 나란히 있음)과 맞춘다.
const existingWith = (options = {}, types = ["flutter"]) => ({
  types,
  options: { envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null, ...options },
});

test("신규 설치(existing=null): dart-define, 스토어 미결정(null), 배포 모드 store_only", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: null }), {
    envMode: "dart-define", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("cli를 생략해도 동작한다", () => {
  assert.strictEqual(resolveFlutterOptions({ existing: null }).envMode, "dart-define");
  assert.strictEqual(resolveFlutterOptions({}).envMode, "dart-define");
});

test("기존 설치(version.yml 있음, 저장값 없음): dotenv를 보존한다", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith() });
  assert.strictEqual(out.envMode, "dotenv");
  assert.strictEqual(out.stores, null);
  assert.strictEqual(out.androidDeployMode, "store_only");
  assert.strictEqual(out.iosDeployMode, "store_only");
});

test("저장값이 있으면 기존 설치 보존값·기본값보다 우선한다", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dart-define", stores: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
});

test("저장된 flutter_store가 'none'이면 빈 배열(선택 안 함)이다", () => {
  assert.deepStrictEqual(resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({ flutterStore: "none" }) }).stores, []);
});

test("기존 설치라도 Flutter가 새로 추가된 경우(타입 목록에 flutter가 없었음)는 dotenv를 보존하지 않고 dart-define이 기본이다", () => {
  const out = resolveFlutterOptions({ cli: NO_CLI, existing: existingWith({}, ["spring"]) });
  assert.strictEqual(out.envMode, "dart-define");
});

test("CLI 값이 저장값을 덮어쓴다", () => {
  const out = resolveFlutterOptions({
    cli: { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare" },
    existing: existingWith({
      envMode: "dart-define", flutterStore: "ios", androidDeployMode: "store_only", iosDeployMode: "store_only",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_prepare",
  });
});

test("CLI 스토어가 빈 배열(--flutter-store none)이면 저장값이 있어도 빈 배열이다", () => {
  const out = resolveFlutterOptions({ cli: { ...NO_CLI, stores: [] }, existing: existingWith({ flutterStore: "android,ios" }) });
  assert.deepStrictEqual(out.stores, []);
});

test("CLI로 일부만 지정하면 나머지는 저장값/기본값을 유지한다", () => {
  const out = resolveFlutterOptions({
    cli: { ...NO_CLI, iosDeployMode: "store_submit" },
    existing: existingWith({ envMode: "dart-define", androidDeployMode: "store_prepare" }),
  });
  assert.strictEqual(out.envMode, "dart-define");
  assert.strictEqual(out.androidDeployMode, "store_prepare");
  assert.strictEqual(out.iosDeployMode, "store_submit");
});

test("저장값이 손으로 고쳐져 유효하지 않으면 무시하고 기본 규칙으로 되돌아간다 (워크플로우에 임의 문자열이 새지 않게)", () => {
  const out = resolveFlutterOptions({
    cli: NO_CLI,
    existing: existingWith({
      envMode: "both", flutterStore: "windows", androidDeployMode: "x' || 'y", iosDeployMode: "publish",
    }),
  });
  assert.deepStrictEqual(out, {
    envMode: "dotenv", stores: null, androidDeployMode: "store_only", iosDeployMode: "store_only",
  });
});

test("createContext: Flutter 옵션 기본값은 '미결정'이다", () => {
  const ctx = createContext();
  assert.strictEqual(ctx.envMode, "");
  assert.strictEqual(ctx.flutterStore, null);
  assert.strictEqual(ctx.androidDeployMode, "");
  assert.strictEqual(ctx.iosDeployMode, "");
});

test("createContext: overrides로 Flutter 옵션을 주입할 수 있다", () => {
  const ctx = createContext({ envMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit" });
  assert.strictEqual(ctx.envMode, "dotenv");
  assert.deepStrictEqual(ctx.flutterStore, ["ios"]);
  assert.strictEqual(ctx.androidDeployMode, "store_prepare");
  assert.strictEqual(ctx.iosDeployMode, "store_submit");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-options-resolve.test.js`
Expected: FAIL — `SyntaxError: The requested module '../../src/core/flutter-options.js' does not provide an export named 'resolveFlutterOptions'`.

- [ ] **Step 3: 최소 구현**

(a) `src/core/flutter-options.js` 파일 **맨 끝**에 추가:

```js

const validOr = (isValid, value, fallback) => (isValid(value) ? value : fallback);

// 옵션 최종 결정 — 우선순위: CLI > version.yml 저장값 > 기본값.
//   cli      { envMode:"", stores:null|string[], androidDeployMode:"", iosDeployMode:"" } (빈값/null = 미지정)
//   existing parseExisting() 결과 또는 null (version.yml이 없으면 신규 설치)
//
// - envMode 기본값: 신규 설치와 "Flutter를 새로 추가하는" 기존 설치는 dart-define, 이미 Flutter가
//   설치돼 있던 프로젝트는 dotenv. 업데이트 한 번에 flutter_dotenv 프로젝트가 조용히 깨지지 않게
//   하려는 것이라, 판단 기준은 "이 프로젝트에 Flutter가 이미 있었는가"다(단순 existing 존재 여부가
//   아니다 — Spring 전용 프로젝트에 flutter 타입을 처음 추가하는 경우까지 dotenv로 묶으면 안 된다).
// - stores: null은 "미결정" — 비대화형은 현행 동작(둘 다 설치), 대화형은 질문한다.
// - 저장값은 유효할 때만 쓴다. version.yml은 사람이 고칠 수 있는데, 그 값이 워크플로우 표현식
//   (`|| 'store_only'` 폴백 자리)에 그대로 들어가므로 목록 밖 문자열은 걸러야 한다.
export function resolveFlutterOptions({ cli = {}, existing = null } = {}) {
  const saved = existing?.options ?? {};
  const hadFlutterAlready = Array.isArray(existing?.types) && existing.types.includes("flutter");
  return {
    envMode: cli.envMode || validOr(isEnvMode, saved.envMode, hadFlutterAlready ? LEGACY_ENV_MODE : DEFAULT_ENV_MODE),
    stores: cli.stores ?? parseStoreList(saved.flutterStore),
    androidDeployMode: cli.androidDeployMode || validOr(isDeployMode, saved.androidDeployMode, DEFAULT_DEPLOY_MODE),
    iosDeployMode: cli.iosDeployMode || validOr(isDeployMode, saved.iosDeployMode, DEFAULT_DEPLOY_MODE),
  };
}
```

(b) `src/context.js` — 앵커 `    includeSemverAuto: null, // null=미설정(다운스트림에서 true로 해석), true/false=명시` 바로 다음 줄에 삽입:

```js
    // Flutter 옵션 (이슈 #131) — Flutter 타입이 없는 프로젝트에서는 전부 무시된다.
    // 결정은 src/core/flutter-options.js의 resolveFlutterOptions가 한다.
    envMode: "",             // "dart-define" | "dotenv". ""=미결정 → 템플릿 기본값(dart-define)
    flutterStore: null,      // 스토어 배포 대상 string[] (예: ["android","ios"]). null=미결정 → 둘 다(현행 동작)
    androidDeployMode: "",   // store_only | store_prepare | store_submit. ""=미결정 → store_only
    iosDeployMode: "",       // 위와 동일 (iOS)
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-options-resolve.test.js tests/node/flutter-options.test.js`
Expected: PASS (fail 0).

---

### Task 3: `@wizard fallback` 마커 + `makeResolvers` Flutter 토큰 4종

**Files:**
- Modify: `src/core/wizard-env.js` (`MARKER_RE`, 신규 `setFallbackLine`, `substituteEnv`의 fallback 분기)
- Modify: `src/core/detect-fs.js` (`makeResolvers` 4번째 인자 + resolver 4종)
- Test: `tests/node/wizard-env.test.js` (확장), `tests/node/env-plan.test.js` (확장)

**Interfaces:**
- Consumes: `flutterOptions = { envMode, androidDeployMode, iosDeployMode, ... } | null` (Task 2의 `resolveFlutterOptions` 결과와 같은 모양. context 필드는 `envMode`/`androidDeployMode`/`iosDeployMode`로 이름이 같아 context 자체를 넘겨도 동작한다).
- Produces:
  - `parseWizardLine(line)` → `action`이 `"ask" | "auto" | "fallback"`
  - `setFallbackLine(line: string, value: string): string` (export, `src/core/wizard-env.js`)
  - `makeResolvers(root, repoName, paths, flutterOptions = null)` — 추가 resolver 토큰:
    - `"project-path"`: `(t) => paths.get(t) || "."`
    - `"flutter-env-mode"`: `() => flutterOptions?.envMode || ""`
    - `"android-deploy-mode"`: `() => flutterOptions?.androidDeployMode || ""`
    - `"ios-deploy-mode"`: `() => flutterOptions?.iosDeployMode || ""`
  - `collectAsks`(`src/ui/env-plan.js`)는 무변경 — `p.action !== "ask"`로 이미 fallback·auto를 제외함을 테스트로 고정한다.

- [ ] **Step 1: 실패하는 테스트 작성**

(a) `tests/node/wizard-env.test.js` — 파일 상단 import를 교체한다. 기존:

```js
import {
  parseWizardLine, setEnvLine, resolveToken, substituteEnv, isUnchanged, replaceProjectTokens,
} from "../../src/core/wizard-env.js";
```

새로:

```js
import {
  parseWizardLine, setEnvLine, setFallbackLine, resolveToken, substituteEnv, isUnchanged, replaceProjectTokens,
} from "../../src/core/wizard-env.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
```

그리고 파일 **맨 끝**에 추가:

```js

// ── @wizard fallback (이슈 #131) ─────────────────────────────────
// 값이 `${{ 런타임값 || 'literal' }}` 표현식인 줄은 setEnvLine의 따옴표 값 치환으로는 다룰 수 없다.
// 마지막 홑따옴표 리터럴(= 런타임 값이 모두 비었을 때의 기본값)만 바꾼다.
const FALLBACK_LINE = `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode`;

test("parseWizardLine: fallback 마커를 파싱한다", () => {
  assert.deepStrictEqual(parseWizardLine(FALLBACK_LINE), {
    indent: "  ", key: "DEPLOY_MODE", action: "fallback", arg: "android-deploy-mode",
  });
});

test("setFallbackLine: 마지막 홑따옴표 리터럴만 교체하고 마커 주석을 제거한다", () => {
  assert.strictEqual(
    setFallbackLine(FALLBACK_LINE, "store_submit"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`,
  );
});

test("setFallbackLine: 리터럴이 여러 개면 마지막 것만 바꾼다", () => {
  const line = `  X: \${{ inputs.a == 'x' && 'y' || 'z' }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "w"), `  X: \${{ inputs.a == 'x' && 'y' || 'w' }}`);
});

test("setFallbackLine: 값이 빈 문자열이면 줄을 그대로 둔다 (setEnvLine과 같은 규약 — 템플릿 기본값 유지)", () => {
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, ""), FALLBACK_LINE);
  assert.strictEqual(setFallbackLine(FALLBACK_LINE, undefined), FALLBACK_LINE);
});

test("setFallbackLine: 새 값이 기존 리터럴과 같아도 마커 주석은 제거한다", () => {
  assert.ok(!setFallbackLine(FALLBACK_LINE, "store_only").includes("@wizard"));
});

test("setFallbackLine: 값 안의 홑따옴표는 표현식 규칙대로 두 개로 이스케이프한다", () => {
  assert.match(setFallbackLine(FALLBACK_LINE, "a'b"), /\|\| 'a''b' \}\}$/);
});

test("setFallbackLine: 표현식에 홑따옴표 리터럴이 없으면 줄을 그대로 둔다", () => {
  const line = `  X: \${{ vars.A }}  # @wizard fallback:t`;
  assert.strictEqual(setFallbackLine(line, "v"), line);
});

test("setFallbackLine: CRLF 줄 끝을 보존한다", () => {
  assert.strictEqual(
    setFallbackLine(`${FALLBACK_LINE}\r`, "store_prepare"),
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_prepare' }}\r`,
  );
});

test("substituteEnv: fallback 줄은 resolver 값으로 교체되고 auto 줄과 함께 처리된다", () => {
  const content = [
    `env:`,
    `  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode`,
    FALLBACK_LINE,
  ].join("\n");
  const out = substituteEnv(content, {
    type: "flutter",
    resolvers: { "flutter-env-mode": () => "dotenv", "android-deploy-mode": () => "store_prepare" },
  });
  assert.strictEqual(out, [
    `env:`,
    `  ENV_MODE: "dotenv"`,
    `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_prepare' }}`,
  ].join("\n"));
});

test("substituteEnv: resolver가 빈 값을 주면 fallback 줄의 템플릿 기본값이 남는다", () => {
  const out = substituteEnv(FALLBACK_LINE, { type: "flutter", resolvers: { "android-deploy-mode": () => "" } });
  assert.strictEqual(out, FALLBACK_LINE);
});

test("substituteEnv: CRLF 파일의 fallback 줄도 처리하고 EOL을 유지한다", () => {
  const content = ["env:", FALLBACK_LINE, ""].join("\r\n");
  const out = substituteEnv(content, { type: "flutter", resolvers: { "android-deploy-mode": () => "store_submit" } });
  assert.strictEqual(
    out,
    ["env:", `  DEPLOY_MODE: \${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_submit' }}`, ""].join("\r\n"),
  );
});

test("isUnchanged: 배포 모드가 바뀌면 같은 원본이라도 설치본과 달라진다 (다음 실행이 upstream 변경으로 갱신하도록)", () => {
  const template = FALLBACK_LINE;
  const resolversFor = (mode) => ({ "android-deploy-mode": () => mode });
  const installed = substituteEnv(template, { type: "flutter", resolvers: resolversFor("store_only") });
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_only") }), true);
  assert.strictEqual(isUnchanged(template, installed, { type: "flutter", resolvers: resolversFor("store_submit") }), false);
});

// ── makeResolvers: 프로젝트 경로·Flutter 토큰 ────────────────────
test("makeResolvers: project-path는 타입별 경로를 돌려주고 없으면 '.'이다", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("project-path", "flutter", r), "app");
  assert.strictEqual(resolveToken("project-path", "react", r), ".");
  assert.strictEqual(resolveToken("project-path", "common", r), ".");
});

test("makeResolvers: flutterOptions가 없으면 Flutter 토큰은 빈 값이다 (템플릿 기본값이 남는다)", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map());
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "");
});

test("makeResolvers: flutterOptions가 있으면 환경변수 방식·플랫폼별 배포 모드를 돌려준다", () => {
  const r = makeResolvers("/nonexistent", "repo", new Map(), {
    envMode: "dotenv", stores: ["android"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
  });
  assert.strictEqual(resolveToken("flutter-env-mode", "flutter", r), "dotenv");
  assert.strictEqual(resolveToken("android-deploy-mode", "flutter", r), "store_prepare");
  assert.strictEqual(resolveToken("ios-deploy-mode", "flutter", r), "store_submit");
});

test("makeResolvers: 기존 resolver(repo, flutter-root)는 그대로 동작한다", () => {
  const r = makeResolvers("/nonexistent", "my-repo", new Map([["flutter", "app"]]));
  assert.strictEqual(resolveToken("repo", "flutter", r), "my-repo");
  assert.strictEqual(resolveToken("flutter-root", "flutter", r), "app");
});
```

(b) `tests/node/env-plan.test.js` — 파일 **맨 끝**에 추가 (상단에 이미 `mkdtempSync, mkdirSync, writeFileSync, rmSync, join, tmpdir, collectAsks` import 됨):

```js

test("collectAsks: @wizard fallback/auto 줄은 질문으로 수집하지 않는다 (ask만 수집, 이슈 #131)", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-fallback-"));
  try {
    const flutterDir = join(root, "workflows", "flutter");
    mkdirSync(flutterDir, { recursive: true });
    writeFileSync(join(flutterDir, "PROJECT-FLUTTER-SAMPLE.yaml"), [
      "name: SAMPLE",
      "env:",
      '  PROJECT_PATH: "."  # @wizard auto:project-path',
      '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode',
      "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode",
      '  ASK_ONLY: "x"  # @wizard ask:x',
      "",
    ].join("\n"));
    const asks = collectAsks(root, ["flutter"]);
    assert.deepStrictEqual(asks.keys, ["ASK_ONLY"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/wizard-env.test.js tests/node/env-plan.test.js`
Expected: `wizard-env.test.js`는 `SyntaxError: ... does not provide an export named 'setFallbackLine'`로 파일 전체 실패. `env-plan.test.js`의 신규 테스트는 통과할 수 있다(현재도 `p.action !== "ask"`로 제외되고 fallback 줄은 파싱 자체가 null) — 회귀 고정용이다.

- [ ] **Step 3: 최소 구현**

(a) `src/core/wizard-env.js` — 4곳 수정.

① 앵커(정확히 이 두 줄)를 교체:

```js
// KEY 정규식: .sh는 [A-Z_]+ (대문자+언더스코어만). ask/auto 마커가 있는 라인만 대상.
const MARKER_RE = /#\s*@wizard\s+(ask|auto):(.*)$/;
```

→

```js
// KEY 정규식: .sh는 [A-Z_]+ (대문자+언더스코어만). ask/auto/fallback 마커가 있는 라인만 대상.
// fallback(이슈 #131)은 `KEY: ${{ 런타임값 || 'literal' }}` 표현식 안의 기본 리터럴을 교체하는 마커다.
const MARKER_RE = /#\s*@wizard\s+(ask|auto|fallback):(.*)$/;
```

② 앵커 `// 한 라인을 파싱해 {indent,key,action,arg} 반환. ask/auto 마커 없으면 null.` → `// 한 라인을 파싱해 {indent,key,action,arg} 반환. ask/auto/fallback 마커 없으면 null.`

③ 앵커(정확히 이 두 줄)를 교체해 `setFallbackLine`을 추가하고 resolver 목록 주석을 갱신:

```js
// resolver — .sh resolve_token 등가. 값 계산은 주입된 resolvers로 위임(순수성 유지).
// resolvers: { repo, "spring-app-yml-dir"(type), "spring-app-yml-path"(type), "flutter-root" }
```

→

```js
// `KEY: ${{ a || b || 'literal' }}  # @wizard fallback:<token>` — 표현식 안의 "마지막 홑따옴표 리터럴"만 교체하고
// 마커 주석을 제거한다. setEnvLine은 `KEY: "값"` 형태의 따옴표 값만 다루므로 GitHub 표현식은 처리하지 못한다.
// 리터럴은 `||` 체인의 맨 끝(런타임 입력·저장소 변수가 모두 비었을 때의 기본값)이라 런타임 우선순위는 바뀌지 않는다.
// value가 빈 문자열이면 줄을 그대로 둔다 (setEnvLine과 같은 규약 — 템플릿 기본값이 남는다).
const WIZARD_COMMENT_RE = /[^\S\r\n]*#[^\S\r\n]*@wizard[^\S\r\n].*$/;
const LAST_LITERAL_RE = /^(.*)'[^']*'([^']*)$/;
export function setFallbackLine(line, value) {
  if (value === "" || value == null) return line;
  const cr = line.endsWith("\r") ? "\r" : "";
  const expression = (cr ? line.slice(0, -1) : line).replace(WIZARD_COMMENT_RE, "");
  if (!LAST_LITERAL_RE.test(expression)) return line;
  const escaped = String(value).replaceAll("'", "''"); // GitHub 표현식 문자열 리터럴의 따옴표 이스케이프
  return expression.replace(LAST_LITERAL_RE, (_m, head, tail) => `${head}'${escaped}'${tail}`) + cr;
}

// resolver — .sh resolve_token 등가. 값 계산은 주입된 resolvers로 위임(순수성 유지).
// resolvers: { repo, "spring-app-yml-dir"(type), "spring-app-yml-path"(type), "flutter-root",
//              "project-path"(type), "flutter-env-mode", "android-deploy-mode", "ios-deploy-mode" }
```

④ `substituteEnv` 루프 앵커(정확히 이 세 줄)를 교체:

```js
    const p = parseWizardLine(lines[i]); // 이미 \r 제거된 라인
    if (!p) continue;
    let val = "";
```

→

```js
    const p = parseWizardLine(lines[i]); // 이미 \r 제거된 라인
    if (!p) continue;
    // fallback은 따옴표 값이 아니라 표현식 안 리터럴을 바꾸므로 ask/auto와 경로가 다르다.
    if (p.action === "fallback") {
      lines[i] = setFallbackLine(lines[i], resolveToken(p.arg, type, resolvers));
      continue;
    }
    let val = "";
```

(b) `src/core/detect-fs.js` — 앵커(정확히 이 세 줄)를 교체:

```js
// 실 resolver 세트 생성 (.sh resolve_token 4종 등가) — index/interactive 공용.
// paths: Map<type, path> (모노레포 경로).
export function makeResolvers(root, repoName, paths) {
```

→

```js
// 실 resolver 세트 생성 (.sh resolve_token 4종 등가) — index/interactive 공용.
// paths: Map<type, path> (모노레포 경로).
// flutterOptions: resolveFlutterOptions 결과 또는 같은 필드를 가진 context (이슈 #131). null이면 Flutter 토큰이
//   빈 값이라 템플릿 기본값(dart-define, store_only)이 그대로 남는다.
export function makeResolvers(root, repoName, paths, flutterOptions = null) {
```

그리고 앵커 `    "flutter-root": () => paths.get("flutter") || ".",` 를 교체:

```js
    "flutter-root": () => paths.get("flutter") || ".",
    // CI changes job의 경로 필터(이슈 #131) — 타입별 프로젝트 루트. 단일 레포·common은 "."(항상 변경됨으로 판정).
    "project-path": (t) => paths.get(t) || ".",
    // 빈 문자열이면 setEnvLine/setFallbackLine이 줄을 건너뛰어 템플릿 기본값이 남는다.
    "flutter-env-mode": () => flutterOptions?.envMode || "",
    "android-deploy-mode": () => flutterOptions?.androidDeployMode || "",
    "ios-deploy-mode": () => flutterOptions?.iosDeployMode || "",
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/wizard-env.test.js tests/node/env-plan.test.js tests/node/deploy-style.test.js`
Expected: PASS (fail 0). `deploy-style.test.js`는 `makeResolvers`를 3인자로 호출하는 기존 코드의 회귀 확인용.

---

### Task 4: `version.yml`에 Flutter 옵션 4개 키 파싱·렌더

**Files:**
- Modify: `src/core/version-yml.js` (`parseTemplateOptions`, `buildVersionYml`, `renderVersionYml`, 신규 내부 함수 `buildFlutterOptionsBlock`)
- Modify: `payload/version.yml.template` (`{{FLUTTER_OPTIONS}}` 전체 줄 토큰 1줄)
- Test: `tests/node/version-yml.test.js` (확장)

**Interfaces:**
- Consumes: Task 1의 `ENV_MODES`, `DEPLOY_MODES`, `DEFAULT_ENV_MODE`, `DEFAULT_DEPLOY_MODE`, `STORE_PLATFORMS`, `formatStoreList`; Task 2가 만든 context 필드 `envMode`, `flutterStore`, `androidDeployMode`, `iosDeployMode`.
- Produces:
  - `parseTemplateOptions(content)` 반환에 `envMode`, `flutterStore`(원문 문자열, 예 `"android,ios"`), `androidDeployMode`, `iosDeployMode` 추가 — 각각 `string | null`(미기재 시 null). `parseExisting(content).options`가 그대로 노출한다.
  - `buildVersionYml({ ..., flutterOptions = {} })` — `flutterOptions: { envMode?, stores?: string[]|null, androidDeployMode?, iosDeployMode? }`. `types`에 `"flutter"`가 있을 때만 `metadata.template.options` 아래에 4개 키 렌더. 값이 비면 `envMode→"dart-define"`, `stores(null)→"android,ios"`, 배포 모드→`"store_only"`. Flutter가 아니면 키도 빈 줄도 출력되지 않는다.
  - `renderVersionYml(context, templateText, {...})`는 `context.envMode/flutterStore/androidDeployMode/iosDeployMode`를 `flutterOptions`로 전달.
  - 렌더 형식(`options:` 아래 6칸 들여쓰기): `env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode` — 값은 큰따옴표, 뒤에 ` # ...` 안내 주석.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/version-yml.test.js`

(a) import 두 줄을 교체. 기존:

```js
import { parseExisting, parseExtraTopLevel, buildVersionYml } from "../../src/core/version-yml.js";
```

새로:

```js
import { parseExisting, parseExtraTopLevel, parseTemplateOptions, buildVersionYml, renderVersionYml } from "../../src/core/version-yml.js";
```

(b) 파일 **맨 끝**에 추가:

```js

// ── Flutter 옵션 4개 키 (이슈 #131) ──────────────────────────────
const FLUTTER_KEYS_RE = /env_mode|flutter_store|android_deploy_mode|ios_deploy_mode/;
const BASE_BUILD = {
  version: "1.0.0", versionCode: 1, branch: "main",
  branches: { main: "main", develop: "develop", mode: "pr-flow" },
  now: "2026-09-21 00:00:00", today: "2026-09-21",
  templateOptions: { templateVersion: "0.10.0" },
};
const buildYml = (extra) => buildVersionYml({ templateText: readVersionYmlTemplate(PAYLOAD), ...BASE_BUILD, ...extra });

test("buildVersionYml: Flutter 타입이면 options 아래 4개 키를 지정값으로 렌더한다", () => {
  const out = buildYml({
    types: ["flutter"],
    flutterOptions: { envMode: "dotenv", stores: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit" },
  });
  assert.match(out, /^      env_mode: "dotenv"/m);
  assert.match(out, /^      flutter_store: "ios"/m);
  assert.match(out, /^      android_deploy_mode: "store_prepare"/m);
  assert.match(out, /^      ios_deploy_mode: "store_submit"/m);
  assert.ok(!out.includes("{{"), `unresolved placeholder in:\n${out}`);
});

test("buildVersionYml: flutterOptions를 생략한 Flutter는 템플릿 기본값과 같은 값으로 렌더한다", () => {
  const out = buildYml({ types: ["flutter"] });
  assert.match(out, /^      env_mode: "dart-define"/m);
  assert.match(out, /^      flutter_store: "android,ios"/m);
  assert.match(out, /^      android_deploy_mode: "store_only"/m);
  assert.match(out, /^      ios_deploy_mode: "store_only"/m);
});

test("buildVersionYml: 스토어를 하나도 고르지 않으면(빈 배열) flutter_store는 \"none\"이다", () => {
  const out = buildYml({ types: ["flutter"], flutterOptions: { stores: [] } });
  assert.match(out, /^      flutter_store: "none"/m);
});

test("buildVersionYml: Flutter 타입이 없으면 4개 키도 빈 줄도 남기지 않는다", () => {
  const out = buildYml({ types: ["react"], flutterOptions: { envMode: "dotenv", stores: ["ios"] } });
  assert.doesNotMatch(out, FLUTTER_KEYS_RE);
  const lastLine = out.trimEnd().split("\n").at(-1);
  assert.match(lastLine, /^      deploy_style:/, `options의 마지막 줄이 deploy_style이어야 한다:\n${out}`);
});

test("buildVersionYml: 멀티 타입(flutter+react)이면 렌더하고 deploy 블록 앞 빈 줄 구조를 유지한다", () => {
  const out = buildYml({
    types: ["flutter", "react"],
    deployValues: new Map([["react", new Map([["HOST", "example"]])]]),
  });
  assert.match(out, /^      ios_deploy_mode:/m);
  assert.ok(out.indexOf("ios_deploy_mode") < out.indexOf("\n\ndeploy:"), "deploy 블록은 옵션 뒤에 온다");
  assert.strictEqual(parseExisting(out).options.iosDeployMode, "store_only");
});

test("parseTemplateOptions: 4개 키가 없으면 전부 null (기존 설치 판별용)", () => {
  const out = parseTemplateOptions(buildYml({ types: ["react"] }));
  assert.strictEqual(out.envMode, null);
  assert.strictEqual(out.flutterStore, null);
  assert.strictEqual(out.androidDeployMode, null);
  assert.strictEqual(out.iosDeployMode, null);
});

test("parseTemplateOptions: 인라인 주석·홑따옴표·따옴표 없는 값을 모두 읽고 다른 옵션과 공존한다", () => {
  const text = [
    "metadata:",
    "  template:",
    "    options:",
    '      env_mode: "dotenv" # dart-define | dotenv',
    "      flutter_store: 'android'",
    "      android_deploy_mode: store_prepare",
    '      ios_deploy_mode: "store_submit"',
    "      semver_auto: true",
  ].join("\n");
  const out = parseTemplateOptions(text);
  assert.strictEqual(out.envMode, "dotenv");
  assert.strictEqual(out.flutterStore, "android");
  assert.strictEqual(out.androidDeployMode, "store_prepare");
  assert.strictEqual(out.iosDeployMode, "store_submit");
  assert.strictEqual(out.semverAuto, true);
});

test("렌더 → 파싱 왕복: buildVersionYml 결과를 parseExisting이 그대로 복원한다", () => {
  const cases = [
    { envMode: "dotenv", stores: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_only", flutterStore: "android" },
    { envMode: "dart-define", stores: ["android", "ios"], androidDeployMode: "store_only", iosDeployMode: "store_prepare", flutterStore: "android,ios" },
    { envMode: "dart-define", stores: [], androidDeployMode: "store_only", iosDeployMode: "store_only", flutterStore: "none" },
  ];
  for (const c of cases) {
    const { flutterStore, ...flutterOptions } = c;
    const { options } = parseExisting(buildYml({ types: ["flutter"], flutterOptions }));
    assert.strictEqual(options.envMode, c.envMode);
    assert.strictEqual(options.flutterStore, flutterStore);
    assert.strictEqual(options.androidDeployMode, c.androidDeployMode);
    assert.strictEqual(options.iosDeployMode, c.iosDeployMode);
  }
});

test("renderVersionYml: context의 Flutter 옵션 필드를 렌더에 반영한다", () => {
  const ctx = createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1, branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
    envMode: "dotenv", flutterStore: ["android"], androidDeployMode: "store_submit", iosDeployMode: "store_only",
  });
  const out = renderVersionYml(ctx, readVersionYmlTemplate(PAYLOAD), {});
  const { options } = parseExisting(out);
  assert.strictEqual(options.envMode, "dotenv");
  assert.strictEqual(options.flutterStore, "android");
  assert.strictEqual(options.androidDeployMode, "store_submit");
  assert.strictEqual(options.iosDeployMode, "store_only");
});

test("renderVersionYml: 미결정 context(빈 envMode·null 스토어)도 유효한 기본값으로 렌더한다", () => {
  const ctx = createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1, branch: "main",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
  });
  const { options } = parseExisting(renderVersionYml(ctx, readVersionYmlTemplate(PAYLOAD), {}));
  assert.strictEqual(options.envMode, "dart-define");
  assert.strictEqual(options.flutterStore, "android,ios");
  assert.strictEqual(options.androidDeployMode, "store_only");
});

test("integration: runFull이 Flutter 옵션을 version.yml에 쓰고 재실행해도 보존한다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-version-yml-flutter-"));
  try {
    const ctx = createContext({
      mode: "full", force: true, types: ["flutter"], version: "1.0.0", versionCode: 1,
      branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
      paths: new Map(), now: "2026-09-21 00:00:00", today: "2026-09-21", templateVersion: "0.10.0",
      envMode: "dotenv", flutterStore: ["ios"], androidDeployMode: "store_prepare", iosDeployMode: "store_submit",
    });
    runFull(ctx, PAYLOAD, target);
    runFull(ctx, PAYLOAD, target);
    const { options } = parseExisting(readFileSync(join(target, "version.yml"), "utf8"));
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_prepare", "store_submit"],
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/version-yml.test.js`
Expected: FAIL — 신규 테스트 다수가 `env_mode` 미렌더(`match` 실패)·`options.envMode`가 `undefined`로 실패. 기존 테스트는 통과.

- [ ] **Step 3: 최소 구현**

(a) `payload/version.yml.template` — 앵커(정확히 이 두 줄)를 교체:

```
      deploy_style: "{{OPT_DEPLOY_STYLE}}" # simple | nginx | traefik | none (서버 배포 워크플로우)
{{DEPLOY}}
```

→

```
      deploy_style: "{{OPT_DEPLOY_STYLE}}" # simple | nginx | traefik | none (서버 배포 워크플로우)
{{FLUTTER_OPTIONS}}
{{DEPLOY}}
```

(`{{FLUTTER_OPTIONS}}`는 `{{PROJECT_PATHS}}`·`{{DEPLOY}}`와 같은 전체 줄 토큰이라 Flutter가 아니면 줄 자체가 출력되지 않는다.)

(b) `src/core/version-yml.js` — 6곳 수정.

① 앵커 `import { escapeYamlDoubleQuoted } from "./wizard-env.js";` 를 교체:

```js
import { escapeYamlDoubleQuoted } from "./wizard-env.js";
import {
  ENV_MODES, DEPLOY_MODES, DEFAULT_ENV_MODE, DEFAULT_DEPLOY_MODE, STORE_PLATFORMS, formatStoreList,
} from "./flutter-options.js";
```

② `parseTemplateOptions` 위 주석·반환 초기값. 앵커(정확히 이 세 줄)를 교체:

```js
// metadata.template.options 상태머신 파싱 (.sh read_template_options L2361~2416 등가).
// 반환: { nexus: bool|null, secretBackup: bool|null } — null=미기재.
```

→

```js
// Flutter 옵션 키(이슈 #131) → 반환 필드. 값은 원문 문자열로 돌려주고, 유효성 판정은 resolveFlutterOptions 몫이다.
const FLUTTER_OPTION_KEYS = {
  env_mode: "envMode", flutter_store: "flutterStore",
  android_deploy_mode: "androidDeployMode", ios_deploy_mode: "iosDeployMode",
};

// metadata.template.options 상태머신 파싱 (.sh read_template_options L2361~2416 등가).
// 반환: { nexus: bool|null, secretBackup: bool|null, semverAuto: bool|null, deployStyle: string|null,
//         envMode/flutterStore/androidDeployMode/iosDeployMode: string|null } — null=미기재.
```

앵커 `  const out = { nexus: null, secretBackup: null, semverAuto: null, deployStyle: null };` 를 교체:

```js
  const out = {
    nexus: null, secretBackup: null, semverAuto: null, deployStyle: null,
    envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null,
  };
```

③ 앵커(정확히 이 두 줄)를 교체해 파싱 분기 추가:

```js
      m = line.match(/^\s+deploy_style:\s*(.+)/);
      if (m) { const v = strip(m[1]); if (v) out.deployStyle = v; continue; }
```

→

```js
      m = line.match(/^\s+deploy_style:\s*(.+)/);
      if (m) { const v = strip(m[1]); if (v) out.deployStyle = v; continue; }
      m = line.match(/^\s+(env_mode|flutter_store|android_deploy_mode|ios_deploy_mode):\s*(.+)/);
      if (m) { const v = strip(m[2]); if (v) out[FLUTTER_OPTION_KEYS[m[1]]] = v; continue; }
```

④ 렌더 함수 추가. 앵커 `// version.yml 전체 생성 — payload/version.yml.template 렌더링.` 를 교체(이 줄 **앞**에 함수를 삽입):

```js
// Flutter 옵션 블록 (전체 줄 토큰 {{FLUTTER_OPTIONS}} — Flutter 타입일 때만). options 아래 6칸 들여쓰기.
// 값이 비었으면 워크플로우 템플릿의 기본값과 같은 값으로 채운다 — 저장값과 실제 설치 내용이 어긋나지 않게.
// stores가 null(미결정)이면 현행 동작대로 둘 다 설치되므로 "android,ios"로 기록한다.
function buildFlutterOptionsBlock({ envMode, stores, androidDeployMode, iosDeployMode } = {}) {
  const quote = (v) => `"${escapeYamlDoubleQuoted(v)}"`;
  return [
    `      env_mode: ${quote(envMode || DEFAULT_ENV_MODE)} # ${ENV_MODES.join(" | ")} (Flutter 환경변수 주입 방식)`,
    `      flutter_store: ${quote(formatStoreList(stores ?? STORE_PLATFORMS))} # android | ios | android,ios | none (스토어 배포 대상)`,
    `      android_deploy_mode: ${quote(androidDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} (Play Store 배포 모드)`,
    `      ios_deploy_mode: ${quote(iosDeployMode || DEFAULT_DEPLOY_MODE)} # ${DEPLOY_MODES.join(" | ")} (iOS 배포 모드)`,
  ].join("\n");
}

// version.yml 전체 생성 — payload/version.yml.template 렌더링.
```

⑤ `buildVersionYml` 주석·시그니처·렌더 루프. 앵커 `//         extraTopLevel?:string[] }  ← 기존 version.yml의 알려지지 않은 최상위 필드 보존 (issue #20 M8)` 를 교체:

```js
//         extraTopLevel?:string[],  ← 기존 version.yml의 알려지지 않은 최상위 필드 보존 (issue #20 M8)
//         flutterOptions?:{ envMode, stores, androidDeployMode, iosDeployMode } }  ← Flutter 타입일 때만 렌더 (이슈 #131)
```

앵커(정확히 이 두 줄)를 교체:

```js
  templateOptions = null, deployValues = new Map(), extraTopLevel = [],
}) {
```

→

```js
  templateOptions = null, deployValues = new Map(), extraTopLevel = [], flutterOptions = {},
}) {
```

앵커 `  const scalars = {` (이 파일에 한 번만 나옴) 를 교체:

```js
  // Flutter 옵션 블록 (full-line 토큰 {{FLUTTER_OPTIONS}} — Flutter 타입일 때만, 아니면 줄 제거)
  const flutterBlock = types.includes("flutter") ? buildFlutterOptionsBlock(flutterOptions) : "";

  const scalars = {
```

앵커 `    if (t === "{{DEPLOY}}") { if (deployBlock) out.push(deployBlock); continue; }` 를 교체:

```js
    if (t === "{{FLUTTER_OPTIONS}}") { if (flutterBlock) out.push(flutterBlock); continue; }
    if (t === "{{DEPLOY}}") { if (deployBlock) out.push(deployBlock); continue; }
```

⑥ `renderVersionYml`. 앵커 `    includeNexus = false, includeSecretBackup = false, includeSemverAuto, deployStyle } = context;` 를 교체:

```js
    includeNexus = false, includeSecretBackup = false, includeSemverAuto, deployStyle,
    envMode, flutterStore, androidDeployMode, iosDeployMode } = context;
```

앵커(정확히 이 두 줄)를 교체:

```js
    deployValues, extraTopLevel,
    templateOptions: {
```

→

```js
    deployValues, extraTopLevel,
    flutterOptions: { envMode, stores: flutterStore, androidDeployMode, iosDeployMode },
    templateOptions: {
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/version-yml.test.js tests/node/branding.test.js tests/node/semver-auto-option.test.js tests/node/deploy-style.test.js tests/node/no-coderabbit.test.js`
Expected: PASS (fail 0). 뒤의 4개는 템플릿·`parseTemplateOptions`를 쓰는 기존 테스트의 회귀 확인용.

---

### Task 5: CLI 플래그 4종 (`args.js`, `help.js`)

**Files:**
- Modify: `src/cli/args.js`
- Modify: `src/cli/help.js`
- Test: `tests/node/args-validation.test.js` (확장)

**Interfaces:**
- Consumes: Task 1의 `ENV_MODES`, `DEPLOY_MODES`, `STORE_PLATFORMS`, `NO_STORE`, `isEnvMode`, `isDeployMode`, `parseStoreList`.
- Produces: `parseArgs(argv)` 결과에 추가되는 필드
  - `flutterEnvMode: string` (`""`=미지정, 그 외 `"dart-define"|"dotenv"`) ← `--flutter-env-mode`
  - `flutterStore: string[] | null` (`null`=미지정, `--flutter-store none` → `[]`) ← `--flutter-store`
  - `androidDeployMode: string`, `iosDeployMode: string` (`""`=미지정) ← `--android-deploy-mode`, `--ios-deploy-mode`
  - 잘못된 값 → `CliError("--<flag> 값이 올바르지 않습니다: <값|(없음)> (<허용값>)")` (`--deploy-style`과 같은 형식)
  - Task 6가 `{ envMode: opts.flutterEnvMode, stores: opts.flutterStore, androidDeployMode: opts.androidDeployMode, iosDeployMode: opts.iosDeployMode }`로 `resolveFlutterOptions`의 `cli`에 넘긴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/args-validation.test.js`

(a) 상단 import 교체. 기존:

```js
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
```

새로:

```js
import { parseArgs, parsePathsCsv, CliError } from "../../src/cli/args.js";
import { HELP_TEXT } from "../../src/cli/help.js";
```

(b) 파일 **맨 끝**에 추가:

```js

// ── Flutter 옵션 플래그 (이슈 #131) ─────────────────────────────
const cliErrorMatching = (re) => (e) => e instanceof CliError && re.test(e.message);

test("parseArgs: Flutter 옵션 플래그를 지정하지 않으면 '미지정' 값이다", () => {
  const opts = parseArgs([]);
  assert.strictEqual(opts.flutterEnvMode, "");
  assert.strictEqual(opts.flutterStore, null);
  assert.strictEqual(opts.androidDeployMode, "");
  assert.strictEqual(opts.iosDeployMode, "");
});

test("parseArgs: --flutter-env-mode는 dart-define/dotenv를 받는다", () => {
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dart-define"]).flutterEnvMode, "dart-define");
  assert.strictEqual(parseArgs(["--flutter-env-mode", "dotenv"]).flutterEnvMode, "dotenv");
});

test("parseArgs: --flutter-env-mode에 잘못된 값·누락은 CliError (both는 만들지 않는다)", () => {
  assert.throws(() => parseArgs(["--flutter-env-mode", "both"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: both \(dart-define \| dotenv\)/));
  assert.throws(() => parseArgs(["--flutter-env-mode"]), cliErrorMatching(/--flutter-env-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --flutter-store는 csv를 배열로, none은 빈 배열로 파싱한다", () => {
  assert.deepStrictEqual(parseArgs(["--flutter-store", "android,ios"]).flutterStore, ["android", "ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "ios"]).flutterStore, ["ios"]);
  assert.deepStrictEqual(parseArgs(["--flutter-store", "none"]).flutterStore, []);
});

test("parseArgs: --flutter-store에 잘못된 값·빈 값·누락은 CliError", () => {
  assert.throws(() => parseArgs(["--flutter-store", "windows"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: windows/));
  assert.throws(() => parseArgs(["--flutter-store", "android,none"]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store", ""]), cliErrorMatching(/--flutter-store/));
  assert.throws(() => parseArgs(["--flutter-store"]), cliErrorMatching(/--flutter-store 값이 올바르지 않습니다: \(없음\)/));
});

test("parseArgs: --android-deploy-mode / --ios-deploy-mode는 세 모드를 각각 받는다", () => {
  const opts = parseArgs(["--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare"]);
  assert.strictEqual(opts.androidDeployMode, "store_submit");
  assert.strictEqual(opts.iosDeployMode, "store_prepare");
  assert.strictEqual(parseArgs(["--android-deploy-mode", "store_only"]).androidDeployMode, "store_only");
});

test("parseArgs: 배포 모드 플래그에 잘못된 값·누락은 CliError", () => {
  assert.throws(() => parseArgs(["--android-deploy-mode", "publish"]),
    cliErrorMatching(/--android-deploy-mode 값이 올바르지 않습니다: publish \(store_only \| store_prepare \| store_submit\)/));
  assert.throws(() => parseArgs(["--ios-deploy-mode", "publish"]), cliErrorMatching(/--ios-deploy-mode/));
  assert.throws(() => parseArgs(["--ios-deploy-mode"]), cliErrorMatching(/--ios-deploy-mode 값이 올바르지 않습니다: \(없음\)/));
});

test("HELP_TEXT: Flutter 옵션 플래그 4종을 안내한다", () => {
  for (const flag of ["--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode"]) {
    assert.ok(HELP_TEXT.includes(flag), `${flag}가 --help에 없다`);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/args-validation.test.js`
Expected: FAIL — 신규 테스트: `parseArgs([])`의 `flutterEnvMode`가 `undefined`, 새 플래그는 `알 수 없는 옵션` CliError로 값 검증 정규식 불일치, HELP 테스트 실패. 기존 테스트는 통과.

- [ ] **Step 3: 최소 구현**

(a) `src/cli/args.js`

앵커 `import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";` 를 교체:

```js
import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import {
  ENV_MODES, DEPLOY_MODES, STORE_PLATFORMS, NO_STORE, isEnvMode, isDeployMode, parseStoreList,
} from "../core/flutter-options.js";
```

앵커 `    deployStyle: "",         // 서버 배포 방식 (--deploy-style). 빈값=version.yml 저장값 → simple` 를 교체:

```js
    deployStyle: "",         // 서버 배포 방식 (--deploy-style). 빈값=version.yml 저장값 → simple
    flutterEnvMode: "",      // Flutter 환경변수 방식 (--flutter-env-mode). 빈값=저장값 → 신규 dart-define/기존 dotenv
    flutterStore: null,      // Flutter 스토어 배포 대상 string[] (--flutter-store). null=미지정, none → []
    androidDeployMode: "",   // Play Store 배포 모드 (--android-deploy-mode). 빈값=저장값 → store_only
    iosDeployMode: "",       // iOS 배포 모드 (--ios-deploy-mode). 빈값=저장값 → store_only
```

앵커(정확히 이 두 줄)를 교체 — `--deploy-style` case 끝:

```js
        result.deployStyle = v; break;
      }
```

→

```js
        result.deployStyle = v; break;
      }
      case "--flutter-env-mode": {
        const v = args.shift();
        if (!isEnvMode(v)) {
          throw new CliError(`--flutter-env-mode 값이 올바르지 않습니다: ${v ?? "(없음)"} (${ENV_MODES.join(" | ")})`);
        }
        result.flutterEnvMode = v; break;
      }
      case "--flutter-store": {
        const v = args.shift();
        // 빈 문자열은 parseStoreList가 []로 보지만, 스토어를 안 고르겠다는 뜻은 명시적인 none으로만 받는다.
        const stores = v ? parseStoreList(v) : null;
        if (stores === null) {
          throw new CliError(`--flutter-store 값이 올바르지 않습니다: ${v || "(없음)"} (${[STORE_PLATFORMS.join(","), ...STORE_PLATFORMS, NO_STORE].join(" | ")})`);
        }
        result.flutterStore = stores; break;
      }
      case "--android-deploy-mode": {
        const v = args.shift();
        if (!isDeployMode(v)) {
          throw new CliError(`--android-deploy-mode 값이 올바르지 않습니다: ${v ?? "(없음)"} (${DEPLOY_MODES.join(" | ")})`);
        }
        result.androidDeployMode = v; break;
      }
      case "--ios-deploy-mode": {
        const v = args.shift();
        if (!isDeployMode(v)) {
          throw new CliError(`--ios-deploy-mode 값이 올바르지 않습니다: ${v ?? "(없음)"} (${DEPLOY_MODES.join(" | ")})`);
        }
        result.iosDeployMode = v; break;
      }
```

(b) `src/cli/help.js` — 앵커 `      --deploy-style STYLE           서버 배포 방식: simple | nginx | traefik | none (기본: simple)` 를 교체:

```
      --deploy-style STYLE           서버 배포 방식: simple | nginx | traefik | none (기본: simple)
      --flutter-env-mode MODE        Flutter 환경변수 방식: dart-define | dotenv (기본: 신규 설치 dart-define, 기존 설치는 저장값·dotenv 유지)
      --flutter-store CSV            Flutter 스토어 배포 대상: android,ios | android | ios | none (기본: 둘 다 설치)
      --android-deploy-mode MODE     Play Store 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
      --ios-deploy-mode MODE         iOS 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/args-validation.test.js tests/node/mode-validation.test.js tests/node/deploy-style.test.js`
Expected: PASS (fail 0).

참고: `--flutter-store` 오류 메시지의 허용값 표기는 `android,ios | android | ios | none`이 된다(`STORE_PLATFORMS.join(",")` = `android,ios`).

---

### Task 6: 비대화형 경로에 옵션 결정 연결 (`src/index.js`)

**Files:**
- Modify: `src/index.js`
- Test: `tests/node/flutter-options-cli.test.js` (신규)

**Interfaces:**
- Consumes: Task 2 `resolveFlutterOptions`, Task 3 `makeResolvers(root, repoName, paths, flutterOptions)`, Task 4 `parseExisting(...).options.*`(테스트 검증용), Task 5 `opts.flutterEnvMode/flutterStore/androidDeployMode/iosDeployMode`.
- Produces: 비대화형(`--mode full`) `createContext(...)`에 `envMode`, `flutterStore`, `androidDeployMode`, `iosDeployMode`가 채워지고, `context.resolvers`가 같은 옵션으로 만들어진다 → D2(복사 필터·정리·앱 파일)·`renderVersionYml`이 소비. 인터랙티브 경로(`src/commands/interactive.js`)는 이 Task에서 건드리지 않는다(D3 담당).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/flutter-options-cli.test.js` 신규 생성

```js
// tests/node/flutter-options-cli.test.js
// 비대화형 경로의 Flutter 옵션 결정 (이슈 #131) — CLI > 저장값 > 기본값, 신규 dart-define / 기존 dotenv 보존.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run } from "../../src/index.js";
import { parseExisting } from "../../src/core/version-yml.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";

const CLOCK = { now: "2026-09-21 00:00:00", today: "2026-09-21" };
const BASE_ARGS = ["--mode", "full", "--force", "--main-branch", "main", "--develop-branch", "develop"];

function flutterTarget() {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: fixture\nversion: 1.0.0+1\n");
  return target;
}

const versionYmlOf = (target) => readFileSync(join(target, "version.yml"), "utf8");
const optionsOf = (target) => parseExisting(versionYmlOf(target)).options;
const install = (target, extraArgs = [], opts = {}) =>
  run([...BASE_ARGS, ...extraArgs], { cwd: target, clock: CLOCK, ...opts });

test("신규 설치: env_mode는 dart-define, 스토어는 미결정(둘 다), 배포 모드는 store_only로 기록한다", async () => {
  const target = flutterTarget();
  try {
    assert.strictEqual(await install(target, ["--type", "flutter"]), 0);
    const options = optionsOf(target);
    assert.strictEqual(options.envMode, "dart-define");
    assert.strictEqual(options.flutterStore, "android,ios");
    assert.strictEqual(options.androidDeployMode, "store_only");
    assert.strictEqual(options.iosDeployMode, "store_only");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("기존 설치(version.yml 있음, env_mode 저장값 없음): dotenv를 보존한다", async () => {
  const target = flutterTarget();
  try {
    // #131 이전에 만들어진 version.yml — Flutter 옵션 4개 키가 없다.
    writeFileSync(join(target, "version.yml"), [
      'version: "1.0.0"',
      "version_code: 1",
      'project_types: ["flutter"]',
      "metadata:",
      "  template:",
      "    options:",
      "      nexus: false",
      "",
    ].join("\n"));
    assert.strictEqual(await install(target), 0);
    assert.strictEqual(optionsOf(target).envMode, "dotenv");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("CLI 플래그는 저장되고, 플래그 없이 재실행해도 유지되며, 다시 지정하면 덮어쓴다", async () => {
  const target = flutterTarget();
  try {
    await install(target, [
      "--type", "flutter",
      "--flutter-env-mode", "dotenv", "--flutter-store", "ios",
      "--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare",
    ]);
    let options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_submit", "store_prepare"],
    );

    await install(target); // 플래그 없음 — 저장값 유지
    options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dotenv", "ios", "store_submit", "store_prepare"],
    );

    await install(target, ["--flutter-env-mode", "dart-define", "--flutter-store", "none"]);
    options = optionsOf(target);
    assert.deepStrictEqual(
      [options.envMode, options.flutterStore, options.androidDeployMode, options.iosDeployMode],
      ["dart-define", "none", "store_submit", "store_prepare"],
      "지정한 플래그만 덮어쓰고 나머지는 저장값을 유지한다",
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("Flutter 타입이 없으면 옵션 키를 기록하지 않는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-node-"));
  writeFileSync(join(target, "package.json"), "{}\n");
  try {
    assert.strictEqual(await install(target, ["--type", "node", "--flutter-env-mode", "dotenv"]), 0);
    assert.doesNotMatch(versionYmlOf(target), /env_mode|flutter_store|android_deploy_mode|ios_deploy_mode/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("resolvers에 옵션이 전달되어 @wizard auto/fallback 토큰이 설치본에 반영된다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-options-wiring-"));
  const payload = mkdtempSync(join(tmpdir(), "paw-flutter-options-payload-"));
  try {
    mkdirSync(join(target, "app"));
    writeFileSync(join(target, "app", "pubspec.yaml"), "name: fixture\nversion: 1.0.0+1\n");
    // 실제 payload 사본에 토큰 3종만 담은 검증용 워크플로우를 얹는다 — 배선(index → makeResolvers)만 본다.
    cpSync(resolvePayloadRoot(), payload, { recursive: true });
    writeFileSync(join(payload, "workflows", "flutter", "PROJECT-FLUTTER-WIRING-CHECK.yaml"), [
      "name: WIRING CHECK",
      "on:",
      "  workflow_dispatch:",
      "env:",
      '  PROJECT_PATH: "."  # @wizard auto:project-path',
      '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode',
      "  ANDROID_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode",
      "  IOS_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:ios-deploy-mode",
      "jobs:",
      "  noop:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
      "",
    ].join("\n"));

    const code = await install(target, [
      "--type", "flutter", "--paths", "flutter=app",
      "--flutter-env-mode", "dotenv",
      "--android-deploy-mode", "store_submit", "--ios-deploy-mode", "store_prepare",
    ], { payloadRoot: payload });
    assert.strictEqual(code, 0);

    const installed = readFileSync(join(target, ".github", "workflows", "PROJECT-FLUTTER-WIRING-CHECK.yaml"), "utf8");
    assert.match(installed, /^ {2}PROJECT_PATH: "app"$/m);
    assert.match(installed, /^ {2}ENV_MODE: "dotenv"$/m);
    assert.match(installed, /^ {2}ANDROID_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.ANDROID_DEPLOY_MODE \|\| 'store_submit' \}\}$/m);
    assert.match(installed, /^ {2}IOS_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.IOS_DEPLOY_MODE \|\| 'store_prepare' \}\}$/m);
    assert.ok(!installed.includes("@wizard"), "마커 주석이 남으면 안 된다");
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-options-cli.test.js`
Expected: FAIL — 1번 테스트(신규 설치 기본값)는 렌더 기본값이 우연히 같아 통과할 수 있고, 2번(기존 설치 `dotenv`: 실제 `"dart-define"`), 3번(플래그 미반영: `dart-define` ≠ `dotenv`), 5번(토큰 미치환: `PROJECT_PATH: "."`가 남고 marker 잔존)은 실패한다.

- [ ] **Step 3: 최소 구현** — `src/index.js` 4곳

① import 추가. 앵커 `import { DEFAULT_DEPLOY_STYLE, isDeployStyle } from "./core/deploy-style.js";` 를 교체:

```js
import { DEFAULT_DEPLOY_STYLE, isDeployStyle } from "./core/deploy-style.js";
import { resolveFlutterOptions } from "./core/flutter-options.js";
```

② 옵션 결정. 앵커 `  const context = createContext({` (이 파일에 한 번만 나옴) 를 교체:

```js
  // Flutter 옵션 — CLI 플래그 → version.yml 저장값 → 기본값(신규 dart-define, 기존 설치 dotenv 보존).
  // Flutter 타입이 없는 프로젝트에서는 렌더·치환 단계가 전부 무시한다.
  const flutterOptions = resolveFlutterOptions({
    cli: {
      envMode: opts.flutterEnvMode, stores: opts.flutterStore,
      androidDeployMode: opts.androidDeployMode, iosDeployMode: opts.iosDeployMode,
    },
    existing,
  });

  const context = createContext({
```

③ resolvers 인자. 앵커 `    resolvers: makeResolvers(cwd, repoName, paths),` 를 교체:

```js
    resolvers: makeResolvers(cwd, repoName, paths, flutterOptions),
```

④ context 필드. 앵커(정확히 이 두 줄)를 교체:

```js
    previousTemplateVersion: existing?.templateVersion || "",
  });
```

→

```js
    previousTemplateVersion: existing?.templateVersion || "",
    envMode: flutterOptions.envMode,
    flutterStore: flutterOptions.stores,
    androidDeployMode: flutterOptions.androidDeployMode,
    iosDeployMode: flutterOptions.iosDeployMode,
  });
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-options-cli.test.js`
Expected: PASS (5개 모두).

이어서 회귀 확인:

Run: `npm run test:node`
Expected: PASS (fail 0). 특히 `e2e-matrix.test.js`(flutter·monorepo 픽스처 설치)·`install-matrix.test.js`·`semver-auto-cli.test.js`·`summary-accuracy-cli.test.js`가 그대로 통과해야 한다.

(D2/D3의 후속 Task가 아직 반영되지 않은 시점이라 `context.flutterStore`는 값만 실리고 필터에 쓰이지 않는다 — 현행 동작 유지.)

### Task 7: 스토어 워크플로우 필터를 복사·충돌 조사·계획 경로에 일관 적용

**Files:**
- Modify: `src/core/copy/workflows.js`
- Test: `tests/node/flutter-store-filter.test.js` (신규)

**Interfaces:**
- Consumes (D1, `src/core/flutter-options.js`): `storeWorkflowFilter(stores: string[] | null) => (filename: string) => boolean`
- Consumes (D1, `src/context.js`): `context.flutterStore: string[] | null` (기본 `null`. 테스트가 `createContext` 없이 만든 평범한 객체에는 필드가 없을 수 있으므로 이 Task의 코드는 `Array.isArray`로만 판단한다)
- Produces (모듈 내부, export 안 함): `buildTypeRootFilter(type: string, deployStyle: string, flutterStore: string[] | null | undefined) => (filename: string) => boolean`
- Produces (동작 계약): `copyWorkflows` / `surveyWorkflows` / `listWorkflowConflicts` / `planWorkflows`가 `type === "flutter"`이고 `context.flutterStore`가 배열일 때 선택되지 않은 스토어 워크플로우(`PLAYSTORE`, `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`)를 복사 대상·충돌 후보·계획 결과·env 치환 대상에서 제외한다. `flutterStore`가 `null`/`undefined`이거나 Flutter가 아닌 타입이면 현행 동작 100% 유지.

**배경 (읽고 확인한 사실):**
- 타입 루트 디렉토리를 다루는 곳이 정확히 4곳이다. ① `copyWorkflowsForType`의 `processDir(typeDir, …, typeRootFilter)` ② 같은 함수 아래쪽 env 치환 루프의 `srcDir === typeDir && deployStyle === NO_DEPLOY_STYLE && !keepDeploy(filename)` ③ `surveyWorkflows`의 `collect(typeDir, …)` ④ `planWorkflows`의 `classify(typeDir, …)`. 이 넷이 서로 다른 파일 집합을 보면 설치·충돌 질문·status/dry-run이 어긋난다.
- `processDir`는 `classify`를 필터 없이 부른 뒤 버킷마다 `.filter(filter)`를 건다. 그래서 `untouched`(= unchanged + localOnly)에는 필터로 걸러진 파일도 들어 있다. 걸러진 파일이 디스크에 이미 있고(이전 설치분) 수정본이면 `changed`로 분류돼 `untouched`에 없으므로, env 치환 루프(②)에서 걸러주지 않으면 사용자 수정본에 `configureEnv`가 돌아 덮어쓴다. ②의 가드가 이 Task의 핵심이다.
- `processDir`의 `filter` 인자는 `undefined`일 때만 기본값 `() => true`가 적용되고 `null`이면 `.filter(null)`로 TypeError가 난다. 그래서 새 헬퍼는 필터가 없을 때도 항상 함수를 돌려준다.
- Flutter 타입 디렉토리(`payload/workflows/flutter/`)에는 하위 폴더가 없다(`server-deploy`/`nexus` 없음). 필터는 타입 루트에만 건다.
- 이 Task 범위 밖이지만 인지할 것: `src/ui/env-plan.js`의 `collectAsks`도 타입 루트를 스캔하므로 선택 해제된 스토어 워크플로우의 ask 키를 물을 수 있다. 소유 초안이 없으므로 이 계획에서는 다루지 않고 조율자에게 보고한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/flutter-store-filter.test.js`:

```js
// tests/node/flutter-store-filter.test.js
// Flutter 스토어 워크플로우 선택 필터 (이슈 #131) — 설치·충돌 조사·계획(status/dry-run)이 같은 파일 집합을 본다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyWorkflows, planWorkflows, surveyWorkflows, listWorkflowConflicts } from "../../src/core/copy/workflows.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { writeBaseline } from "../../src/core/baseline.js";

const PAYLOAD = resolvePayloadRoot();
const WF_DIR = ".github/workflows";

const PLAY = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const TESTFLIGHT_TEST = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
// 스토어 선택과 무관하게 항상 설치되는 Flutter 워크플로우
const ALWAYS = [
  "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml",
  "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml",
  "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml",
  "PROJECT-FLUTTER-APP-BUILD-TRIGGER.yaml",
  "PROJECT-FLUTTER-CI.yaml",
];

function flutterContext(overrides = {}) {
  return createContext({
    mode: "full", force: true, types: ["flutter"], version: "1.0.0",
    branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths: new Map(), repoName: "app", resolvers: {},
    ...overrides,
  });
}

const freshTarget = () => mkdtempSync(join(tmpdir(), "paw-store-filter-"));
const installedFlutter = (target) =>
  readdirSync(join(target, WF_DIR)).filter((f) => f.startsWith("PROJECT-FLUTTER-")).sort();
const plannedFlutter = (plan, bucket = "newFiles") =>
  plan[bucket].filter((f) => f.type === "flutter").map((f) => f.filename).sort();

test("flutterStore null: 스토어 필터가 없어 Flutter 워크플로우 8종이 전부 계획·설치된다 (현행 동작)", () => {
  const target = freshTarget();
  try {
    const all = [PLAY, TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: null });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), all);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), all);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore 필드가 아예 없는 평범한 context도 현행 동작과 같다", () => {
  const target = freshTarget();
  try {
    const ctx = { types: ["flutter"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(installedFlutter(target).length, 8);
    assert.strictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target), "unchanged").length, 8);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [android]: iOS 워크플로우 2종만 빠지고 나머지는 그대로다 — 설치와 계획이 일치한다", () => {
  const target = freshTarget();
  try {
    const expected = [PLAY, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["android"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore [ios]: PLAYSTORE만 빠진다", () => {
  const target = freshTarget();
  try {
    const expected = [TESTFLIGHT, TESTFLIGHT_TEST, ...ALWAYS].sort();
    const ctx = flutterContext({ flutterStore: ["ios"] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), expected);
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), expected);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore []: 스토어 워크플로우가 하나도 설치되지 않는다 (none 선택)", () => {
  const target = freshTarget();
  try {
    const ctx = flutterContext({ flutterStore: [] });
    assert.deepStrictEqual(plannedFlutter(planWorkflows(ctx, PAYLOAD, target)), [...ALWAYS].sort());
    copyWorkflows(ctx, PAYLOAD, target);
    assert.deepStrictEqual(installedFlutter(target), [...ALWAYS].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("Flutter가 아닌 타입은 flutterStore가 무엇이든 계획이 달라지지 않는다", () => {
  const target = freshTarget();
  try {
    const base = { types: ["react"], paths: new Map(), repoName: "app", resolvers: {}, branches: { main: "main", develop: "develop", mode: "pr-flow" } };
    const withStore = planWorkflows({ ...base, flutterStore: [] }, PAYLOAD, target);
    const without = planWorkflows({ ...base, flutterStore: null }, PAYLOAD, target);
    assert.deepStrictEqual(withStore, without);
    assert.ok(withStore.newFiles.some((f) => f.type === "react"));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("surveyWorkflows/listWorkflowConflicts: 선택 해제된 스토어 워크플로우의 수정본은 충돌 질문 대상이 아니다", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    for (const f of [PLAY, TESTFLIGHT]) {
      const p = join(target, WF_DIR, f);
      writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");
    }
    const ctx = flutterContext({ flutterStore: ["android"] });
    const names = surveyWorkflows(ctx, PAYLOAD, target).conflicts.map((c) => c.filename);
    assert.deepStrictEqual(names, [PLAY], "선택된 PLAYSTORE 수정본만 충돌, 선택 해제된 TESTFLIGHT는 묻지 않는다");
    assert.deepStrictEqual(listWorkflowConflicts(ctx, PAYLOAD, target).map((c) => c.filename), [PLAY]);
    // 선택 미결정(null)이면 둘 다 충돌 — 현행 동작
    const nullNames = surveyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target).conflicts.map((c) => c.filename).sort();
    assert.deepStrictEqual(nullNames, [PLAY, TESTFLIGHT].sort());
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("copyWorkflows: 선택 해제된 스토어 워크플로우 수정본은 env 치환으로도 건드리지 않는다 (바이트 보존)", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    // @wizard 마커가 있는 사용자 수정본 — 가드가 없으면 configureEnv가 "app"으로 덮고 마커를 지운다.
    const mine = 'name: 내 워크플로우\nenv:\n  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root\n';
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, mine);

    const ctx = flutterContext({ flutterStore: ["android"], resolvers: { "flutter-root": () => "app" } });
    copyWorkflows(ctx, PAYLOAD, target);
    assert.strictEqual(readFileSync(p, "utf8"), mine);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("planWorkflows: 선택 해제된 스토어 워크플로우는 baseline에 있는데 디스크에 없어도 removed로 보고하지 않는다", () => {
  const target = freshTarget();
  try {
    copyWorkflows(flutterContext({ flutterStore: null }), PAYLOAD, target);
    writeBaseline(target, {
      templateVersion: "0.10.0", installedAt: "2026-09-21",
      entries: new Map([[TESTFLIGHT, { installed: "sha256:x", rendered: "sha256:y" }]]),
    });
    rmSync(join(target, WF_DIR, TESTFLIGHT));

    const removedNames = (ctx) => planWorkflows(ctx, PAYLOAD, target).removed.map((f) => f.filename);
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: null })), [TESTFLIGHT], "현행 동작: 사용자가 지운 파일");
    assert.deepStrictEqual(removedNames(flutterContext({ flutterStore: ["android"] })), [], "선택 해제된 파일은 지운 게 아니라 원래 대상이 아니다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/flutter-store-filter.test.js
```

예상: `flutterStore null`·`필드가 없는`·`Flutter가 아닌 타입` 테스트는 통과(현행 동작 고정용). `[android]`, `[ios]`, `[]`, `surveyWorkflows…`, `env 치환으로도…`, `planWorkflows: … removed로 보고하지 않는다` 테스트는 필터가 없어 실패(예: `[android]`에서 실제 목록에 `IOS-TESTFLIGHT`가 남아 `deepStrictEqual` 불일치).

- [ ] **Step 3: 최소 구현**

`src/core/copy/workflows.js`를 다음과 같이 수정한다(모두 이 파일 안, 앵커는 현재 파일 그대로).

3-1. import — 기존 `deploy-style.js` import 줄 바로 아래에 한 줄 추가:

```js
import { deployFilter, isDeployWorkflow, activateDeployTrigger, DEFAULT_DEPLOY_STYLE, NO_DEPLOY_STYLE } from "../deploy-style.js";
import { storeWorkflowFilter } from "../flutter-options.js";
```

3-2. 헬퍼 — `const TRUNK_BASED_EXCLUDED = new Set([ … ]);` 블록 바로 아래에 추가:

```js
// 타입 루트 디렉토리에 거는 파일 필터 — "배포 안 함"의 CD 제외와 Flutter 스토어 대상 선택을 합성한다.
// copyWorkflowsForType·surveyWorkflows·planWorkflows가 같은 함수를 써야 설치·충돌 조사·status/dry-run이
// 서로 다른 파일 집합을 보지 않는다. flutterStore가 배열이 아니면(null=미결정, 비대화형 기본) 스토어 필터는
// 걸지 않는다. 필터가 없어도 항상 함수를 돌려준다 — processDir은 null을 받지 못한다.
function buildTypeRootFilter(type, deployStyle, flutterStore) {
  const filters = [];
  if (deployStyle === NO_DEPLOY_STYLE) filters.push(deployFilter(deployStyle));
  if (type === "flutter" && Array.isArray(flutterStore)) filters.push(storeWorkflowFilter(flutterStore));
  return (filename) => filters.every((keep) => keep(filename));
}
```

3-3. `copyWorkflows` 상단 주석의 context 설명에 필드 한 줄 추가 — 기존 `//            envValues?:Map<key,value>, envUseDefaults?:boolean }  ← env 계획(promptEnvPlan) 결과 주입점` 줄 다음에:

```js
//            flutterStore?:string[]|null }  ← Flutter 스토어 대상 (null=필터 없음, 배열=선택된 플랫폼만)
```

3-4. `copyWorkflowsForType` — 함수 첫 destructure와 타입 루트 처리 교체.

기존:

```js
  const { includeNexus, deployStyle = "", envOptsFor, collectAsks = null, dirCtx } = ctx;
  const keepDeploy = deployFilter(deployStyle);
```

변경:

```js
  const { includeNexus, deployStyle = "", flutterStore = null, envOptsFor, collectAsks = null, dirCtx } = ctx;
  const keepDeploy = deployFilter(deployStyle);
  const keepTypeRoot = buildTypeRootFilter(type, deployStyle, flutterStore);
```

기존:

```js
  if (exists(typeDir)) {
    const typeRootFilter = deployStyle === NO_DEPLOY_STYLE ? keepDeploy : undefined;
    const c = processDir(typeDir, workflowsDir, envOpts, dirCtx, counters, typeRootFilter);
    untouched.push(...c.unchanged, ...c.localOnly);
  }
```

변경:

```js
  if (exists(typeDir)) {
    const c = processDir(typeDir, workflowsDir, envOpts, dirCtx, counters, keepTypeRoot);
    untouched.push(...c.unchanged, ...c.localOnly);
  }
```

기존(env 치환 루프 안):

```js
      if (srcDir === typeDir && deployStyle === NO_DEPLOY_STYLE && !keepDeploy(filename)) continue; // 타입 루트 CD도 배제
```

변경(선택 해제된 스토어 워크플로우의 수정본을 치환으로 덮지 않는다):

```js
      if (srcDir === typeDir && !keepTypeRoot(filename)) continue; // 타입 루트: 배제된 CD·안 고른 스토어 워크플로우
```

3-4 주석 위치 참고: 바로 위 `// 타입별 워크플로우 (직하위). …` 주석은 그대로 둔다.

3-5. `surveyWorkflows` — destructure에 `flutterStore = null` 추가.

기존:

```js
  const { types = [], paths = new Map(), includeNexus = false, repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const branchMode = context.branches?.mode || "pr-flow";
  const conflicts = [];
```

변경(첫 줄만):

```js
  const { types = [], paths = new Map(), includeNexus = false, repoName = "", resolvers = {}, flutterStore = null } = context;
```

기존:

```js
      collect(typeDir, envOpts, type, () => false, deployStyle === NO_DEPLOY_STYLE ? keepDeploy : null);
```

변경:

```js
      collect(typeDir, envOpts, type, () => false, buildTypeRootFilter(type, deployStyle, flutterStore));
```

3-6. `planWorkflows` — destructure에 `flutterStore = null` 추가.

기존:

```js
  const { types = [], paths = new Map(), includeNexus = false, includeSecretBackup = false, repoName = "", resolvers = {} } = context;
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const projectTypesDir = join(payloadRoot, PAYLOAD.workflowsDir);
  const deployStyle = context.deployStyle || DEFAULT_DEPLOY_STYLE;
  const srcText = makeSrcText(context.branches || null, deployStyle);
  const baseline = readBaseline(targetRoot);
  const branchMode = context.branches?.mode || "pr-flow";
  // upstreamOnly/localOnly/removed는 baseline이 있을 때만 채워진다 (issue #69).
```

변경(첫 줄만 — `planWorkflows` 쪽은 `includeSecretBackup`이 있는 줄이며 `copyWorkflows`의 destructure(`envValues`, `envUseDefaults` 포함)와 혼동하지 않는다):

```js
  const { types = [], paths = new Map(), includeNexus = false, includeSecretBackup = false, repoName = "", resolvers = {}, flutterStore = null } = context;
```

기존:

```js
      const typeRootFilter = deployStyle === NO_DEPLOY_STYLE ? deployFilter(deployStyle) : null;
      merge(classify(typeDir, workflowsDir, envOpts, srcText, baseline, typeRootFilter), type);
```

변경:

```js
      merge(classify(typeDir, workflowsDir, envOpts, srcText, baseline, buildTypeRootFilter(type, deployStyle, flutterStore)), type);
```

`deployFilter`·`NO_DEPLOY_STYLE`는 파일의 다른 곳에서 계속 쓰이므로 import는 그대로 둔다.

- [ ] **Step 4: 통과 확인 (신규 + 기존 회귀)**

```bash
node --test tests/node/flutter-store-filter.test.js tests/node/plan-workflows.test.js tests/node/deploy-style.test.js tests/node/workflow-conflicts.test.js tests/node/workflows-copied-files.test.js tests/node/install-matrix.test.js
```

예상: 전부 통과(`plan-workflows`, `deploy-style`, `workflow-conflicts`가 "필터 없음 = 현행 동작" 회귀 방어선이다).

---

### Task 7b: env 계획 질문(`collectAsks`/`promptEnvPlan`)에도 스토어 워크플로우 필터 적용

**실행 위치:** Task 7 바로 뒤. 커밋 스텝 없음(서브에이전트는 커밋하지 않는다 — 최종 /prp-commit에서 일괄).
**소유권:** 이 Task에 한해 `src/ui/env-plan.js`를 D2가 수정한다(D1은 fallback 마커 관련 테스트만). `interactive.js`의 호출부 전달은 D3 Task 11이 처리하므로 이 Task는 `env-plan.js`, `workflows.js`(export 한 단어), 테스트만 다룬다.

**Files:**
- Modify: `src/ui/env-plan.js`
- Modify: `src/core/copy/workflows.js` (Task 7의 `buildTypeRootFilter`를 `export`로 바꾸기만 한다)
- Test: `tests/node/env-plan.test.js` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes (Task 7): `buildTypeRootFilter(type, deployStyle, flutterStore) => (filename) => boolean` — `workflows.js`에서 export. 설치·충돌 조사·계획과 같은 함수를 써야 "질문 범위 = 설치 범위"가 유지된다.
- Produces: `collectAsks(payloadRoot, types, opts)`의 `opts.flutterStore?: string[] | null`, `promptEnvPlan({ …, flutterStore })` — 둘 다 기본 `null`. `null`/`undefined`이면 현행 동작 100% 유지(필터 함수는 `() => true`와 동치). 배열이면 Flutter 타입 루트 스캔에서 선택 해제된 스토어 워크플로우(`PLAYSTORE`, `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`)를 건너뛰어 그 파일에만 있는 ask 키를 수집하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/env-plan.test.js` 파일 끝에 추가한다(기존 import `mkdtempSync, mkdirSync, writeFileSync, rmSync`, `join`, `tmpdir`, `collectAsks`, `promptEnvPlan`을 그대로 쓴다).

```js
// Flutter 스토어 워크플로우 선택 (이슈 #131) — 설치하지 않을 워크플로우의 질문은 묻지 않는다.
function makeFlutterFixturePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-env-plan-flutter-"));
  const dir = join(root, "workflows", "flutter");
  mkdirSync(dir, { recursive: true });
  const files = {
    "PROJECT-FLUTTER-CI.yaml": "CI_ONLY",
    "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml": "PLAY_ONLY",
    "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml": "TESTFLIGHT_ONLY",
    "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml": "TEST_TESTFLIGHT_ONLY",
  };
  for (const [name, key] of Object.entries(files)) {
    writeFileSync(join(dir, name), ["name: X", "env:", `  ${key}: "v" # @wizard ask:v`, ""].join("\n"));
  }
  return root;
}

test("collectAsks: flutterStore가 null/미지정이면 스토어 워크플로우의 ask 키도 전부 수집된다 (현행 동작)", () => {
  const root = makeFlutterFixturePayload();
  try {
    for (const opts of [{ flutterStore: null }, {}]) {
      const asks = collectAsks(root, ["flutter"], opts);
      for (const k of ["CI_ONLY", "PLAY_ONLY", "TESTFLIGHT_ONLY", "TEST_TESTFLIGHT_ONLY"]) {
        assert.ok(asks.keys.includes(k), `${k} (${JSON.stringify(opts)})`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collectAsks: 선택 해제된 스토어 워크플로우의 ask 키는 수집되지 않는다", () => {
  const root = makeFlutterFixturePayload();
  try {
    const android = collectAsks(root, ["flutter"], { flutterStore: ["android"] });
    assert.deepStrictEqual([...android.keys].sort(), ["CI_ONLY", "PLAY_ONLY"]);

    const ios = collectAsks(root, ["flutter"], { flutterStore: ["ios"] });
    assert.deepStrictEqual([...ios.keys].sort(), ["CI_ONLY", "TESTFLIGHT_ONLY", "TEST_TESTFLIGHT_ONLY"]);

    const none = collectAsks(root, ["flutter"], { flutterStore: [] });
    assert.deepStrictEqual(none.keys, ["CI_ONLY"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collectAsks: Flutter가 아닌 타입은 flutterStore의 영향을 받지 않는다", () => {
  const root = makeFlutterFixturePayload();
  try {
    const dir = join(root, "workflows", "react");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT-REACT-CI.yaml"), ["name: R", "env:", '  REACT_ONLY: "v" # @wizard ask:v', ""].join("\n"));
    const asks = collectAsks(root, ["react"], { flutterStore: [] });
    assert.deepStrictEqual(asks.keys, ["REACT_ONLY"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("promptEnvPlan: flutterStore를 collectAsks까지 전달해 답변 목록에도 해제된 워크플로우 키가 없다", async () => {
  const root = makeFlutterFixturePayload();
  try {
    const result = await promptEnvPlan({ payloadRoot: root, types: ["flutter"], force: true, flutterStore: ["android"], log: () => {} });
    assert.deepStrictEqual(result.answers.map((a) => a.key).sort(), ["CI_ONLY", "PLAY_ONLY"]);
    const all = await promptEnvPlan({ payloadRoot: root, types: ["flutter"], force: true, log: () => {} });
    assert.strictEqual(all.answers.length, 4, "미지정(null)이면 현행 동작");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/env-plan.test.js
```

예상: `null`/미지정 테스트와 `Flutter가 아닌 타입` 테스트는 통과(현행 동작 고정). `선택 해제된…`, `promptEnvPlan: flutterStore를…` 테스트는 필터가 없어 `keys`에 `TESTFLIGHT_ONLY` 등이 남아 `deepStrictEqual` 불일치로 실패.

- [ ] **Step 3: 최소 구현**

3-1. `src/core/copy/workflows.js` — Task 7 3-2에서 만든 헬퍼 선언에 `export`만 붙인다.

기존:

```js
function buildTypeRootFilter(type, deployStyle, flutterStore) {
```

변경:

```js
export function buildTypeRootFilter(type, deployStyle, flutterStore) {
```

3-2. `src/ui/env-plan.js` — import. 기존 줄 바로 아래에 추가(`deployFilter`는 `keepDeploy`, `NO_DEPLOY_STYLE`는 server-deploy 분기에서 계속 쓰이므로 유지):

```js
import { deployFilter, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { buildTypeRootFilter } from "../core/copy/workflows.js";
```

3-3. `collectAsks` 주석의 opts 설명 — 기존 `//   includeNexus - true면 server-deploy 제외 + nexus/ 포함 (복사 엔진과 스캔 범위 일치)` 줄 다음에 추가:

```js
//   flutterStore - Flutter 스토어 대상(string[]|null). 배열이면 선택 해제된 스토어 워크플로우는 스캔에서 제외 (null=현행)
```

3-4. `collectAsks` 본문 — destructure.

기존:

```js
  const { resolvers = {}, includeNexus = false, includeSecretBackup = false, deployStyle = "", prompts = null } = opts;
```

변경:

```js
  const { resolvers = {}, includeNexus = false, includeSecretBackup = false, deployStyle = "", flutterStore = null, prompts = null } = opts;
```

타입 루트 unit.

기존:

```js
    units.push([type, typeDir, deployStyle === NO_DEPLOY_STYLE ? keepDeploy : null]);
```

변경(복사 엔진·충돌 조사·계획과 같은 필터를 쓴다. "none"의 CD 제외 동작은 동일하다):

```js
    units.push([type, typeDir, buildTypeRootFilter(type, deployStyle, flutterStore)]);
```

바로 위 주석 블록(`// PR 프리뷰 자체의 ask 키(…) … 의도된 잔여 범위다.`) 끝에 한 줄 추가:

```js
    // Flutter는 선택 해제된 스토어 워크플로우(PLAYSTORE·TESTFLIGHT)도 같은 필터로 걸러 질문 범위가 설치 범위와 같다.
```

3-5. `promptEnvPlan` — 인자와 호출.

기존:

```js
  includeNexus = false, includeSecretBackup = false, deployStyle = "", targetRoot = ".", repoName = "", log = defaultLog,
} = {}) {
  const prompts = loadWizardPrompts(targetRoot, payloadRoot);
  const asks = collectAsks(payloadRoot, types, { resolvers, includeNexus, includeSecretBackup, deployStyle, prompts });
```

변경:

```js
  includeNexus = false, includeSecretBackup = false, deployStyle = "", flutterStore = null, targetRoot = ".", repoName = "", log = defaultLog,
} = {}) {
  const prompts = loadWizardPrompts(targetRoot, payloadRoot);
  const asks = collectAsks(payloadRoot, types, { resolvers, includeNexus, includeSecretBackup, deployStyle, flutterStore, prompts });
```

`promptEnvPlan` 위 인자 설명 주석의 `//   payloadRoot/types/resolvers/includeNexus — collectAsks와 동일 의미`는 `//   payloadRoot/types/resolvers/includeNexus/flutterStore — collectAsks와 동일 의미`로 고친다.

- [ ] **Step 4: 통과 확인 (신규 + 회귀)**

```bash
node --test tests/node/env-plan.test.js tests/node/flutter-store-filter.test.js tests/node/deploy-style.test.js
```

예상: 전부 통과(`deploy-style`의 none 케이스가 `buildTypeRootFilter` 치환 회귀 방어선).

---

### Task 8: Flutter 앱 파일(fastlane·ExportOptions) 복사 모듈 신규

**Files:**
- Create: `src/core/copy/flutter-app.js`
- Test: `tests/node/flutter-app-copy.test.js` (신규)

**Interfaces:**
- Consumes (D1, `src/core/flutter-options.js`): `storeAppFilesFor(stores: string[] | null) => string[]` — `payload/flutter-app/` 기준 상대경로(`android/fastlane/Fastfile.playstore`, `ios/fastlane/Fastfile`, `ios/ExportOptions.plist` 중 선택 플랫폼 것. `null`이면 3개 전부)
- Consumes (기존, `src/core/fsutil.js`): `copyFileSync(src, dst)` — 부모 디렉토리 자동 생성 + 바이트 그대로 복사(CRLF 보존)
- Produces (`src/core/copy/flutter-app.js`, 계약 §8 그대로):
  - `copyFlutterAppFiles(context, payloadRoot, targetRoot = ".") → { created: string[], kept: string[] }`
  - `planFlutterAppFiles(context, payloadRoot, targetRoot = ".") → { created: string[], kept: string[] }` (읽기 전용, 같은 계산)
  - 반환 경로: `targetRoot` 기준 상대 POSIX 경로(예: `app/android/fastlane/Fastfile.playstore`). 대상은 `context.types`에 `flutter`가 있을 때만; 그 외는 `{ created: [], kept: [] }`.
  - 목적지는 `join(targetRoot, context.paths.get("flutter") || ".", rel)`. 이미 있으면 `kept`(덮어쓰지 않음).
- 원본 위치: `<payloadRoot>/flutter-app/<rel>` (D6가 만든다. 이 Task의 테스트는 임시 payload를 직접 만들어 D6에 의존하지 않는다.)

**결정 (계약 모호성):** payload 하위 폴더명 `flutter-app`은 이 모듈의 로컬 상수로 둔다(`src/core/paths.js`는 어느 초안의 소유도 아니므로 건드리지 않는다). 원본 파일이 payload에 없으면 `copyFlutterAppFiles`는 `ENOENT`를 그대로 던진다 — 패키징 오류를 조용히 삼키지 않는다(`copyWorkflows`의 "패키지 구조 오류" 예외와 같은 태도). `planFlutterAppFiles`는 원본을 읽지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/flutter-app-copy.test.js`:

```js
// tests/node/flutter-app-copy.test.js
// Flutter 앱 파일(fastlane·ExportOptions) 복사 (이슈 #131) — 없을 때만 생성, 절대 덮어쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { copyFlutterAppFiles, planFlutterAppFiles } from "../../src/core/copy/flutter-app.js";

const ANDROID_FASTFILE = "android/fastlane/Fastfile.playstore";
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const IOS_EXPORT = "ios/ExportOptions.plist";
const ALL = [ANDROID_FASTFILE, IOS_FASTFILE, IOS_EXPORT];

// D6의 실제 payload에 의존하지 않도록 테스트 안에서 원본 트리를 만든다. iOS Fastfile은 CRLF로 둔다.
function makePayload() {
  const root = mkdtempSync(join(tmpdir(), "paw-fa-payload-"));
  const contents = {
    [ANDROID_FASTFILE]: "# android fastfile\nlane :deploy_internal do\nend\n",
    [IOS_FASTFILE]: "# ios fastfile\r\nlane :deploy do\r\nend\r\n",
    [IOS_EXPORT]: "<plist>__TEAM_ID__</plist>\n",
  };
  for (const [rel, body] of Object.entries(contents)) {
    const p = join(root, "flutter-app", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return { root, contents };
}

const freshTarget = () => mkdtempSync(join(tmpdir(), "paw-fa-target-"));
const ctx = (overrides = {}) => ({ types: ["flutter"], paths: new Map(), flutterStore: null, ...overrides });

test("신규 설치: 3개 파일을 만들고 디렉토리도 자동 생성한다", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual([...r.created].sort(), [...ALL].sort());
    assert.deepStrictEqual(r.kept, []);
    for (const rel of ALL) assert.strictEqual(readFileSync(join(target, rel), "utf8"), contents[rel]);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("이미 있는 파일은 덮어쓰지 않고 kept로 보고한다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "ios"), { recursive: true });
    writeFileSync(join(target, IOS_EXPORT), "내가 채운 값\n");

    const r = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(r.kept, [IOS_EXPORT]);
    assert.deepStrictEqual([...r.created].sort(), [ANDROID_FASTFILE, IOS_FASTFILE].sort());
    assert.strictEqual(readFileSync(join(target, IOS_EXPORT), "utf8"), "내가 채운 값\n");

    const again = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(again.created, []);
    assert.deepStrictEqual([...again.kept].sort(), [...ALL].sort());
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("모노레포: paths.flutter 아래에 만들고 반환 경로도 그 접두사를 갖는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ paths: new Map([["flutter", "app"]]) }), root, target);
    assert.deepStrictEqual([...r.created].sort(), ALL.map((rel) => `app/${rel}`).sort());
    assert.ok(existsSync(join(target, "app", ANDROID_FASTFILE)));
    assert.ok(!existsSync(join(target, "android")), "레포 루트에는 만들지 않는다");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("선택 플랫폼만: android / ios / none(빈 배열)", () => {
  const { root } = makePayload();
  try {
    const cases = [
      [["android"], [ANDROID_FASTFILE]],
      [["ios"], [IOS_FASTFILE, IOS_EXPORT]],
      [[], []],
    ];
    for (const [stores, expected] of cases) {
      const target = freshTarget();
      try {
        const r = copyFlutterAppFiles(ctx({ flutterStore: stores }), root, target);
        assert.deepStrictEqual([...r.created].sort(), [...expected].sort(), `stores=${JSON.stringify(stores)}`);
        for (const rel of ALL) assert.strictEqual(existsSync(join(target, rel)), expected.includes(rel), rel);
      } finally { rmSync(target, { recursive: true, force: true }); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Flutter 타입이 없으면 아무것도 만들지 않는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    const r = copyFlutterAppFiles(ctx({ types: ["react"] }), root, target);
    assert.deepStrictEqual(r, { created: [], kept: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("CRLF 원본은 바이트 그대로 복사된다", () => {
  const { root, contents } = makePayload();
  const target = freshTarget();
  try {
    copyFlutterAppFiles(ctx(), root, target);
    const copied = readFileSync(join(target, IOS_FASTFILE));
    assert.ok(copied.equals(Buffer.from(contents[IOS_FASTFILE], "utf8")));
    assert.ok(copied.includes(Buffer.from("\r\n")));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: 복사와 같은 결과를 계산하되 아무 파일도 쓰지 않는다", () => {
  const { root } = makePayload();
  const target = freshTarget();
  try {
    mkdirSync(join(target, "android/fastlane"), { recursive: true });
    writeFileSync(join(target, ANDROID_FASTFILE), "기존\n");

    const planned = planFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual(planned.kept, [ANDROID_FASTFILE]);
    assert.deepStrictEqual([...planned.created].sort(), [IOS_FASTFILE, IOS_EXPORT].sort());
    assert.ok(!existsSync(join(target, "ios")), "plan은 읽기 전용이다");

    const copied = copyFlutterAppFiles(ctx(), root, target);
    assert.deepStrictEqual({ created: [...copied.created].sort(), kept: copied.kept },
      { created: [...planned.created].sort(), kept: planned.kept });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});

test("planFlutterAppFiles: 원본 payload를 읽지 않으므로 payload가 없어도 계산된다", () => {
  const target = freshTarget();
  try {
    const planned = planFlutterAppFiles(ctx(), join(target, "no-such-payload"), target);
    assert.strictEqual(planned.created.length, 3);
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/flutter-app-copy.test.js
```

예상: `ERR_MODULE_NOT_FOUND` — `src/core/copy/flutter-app.js`가 아직 없다.

- [ ] **Step 3: 최소 구현**

`src/core/copy/flutter-app.js` (신규):

```js
// Flutter 앱 소유 파일(fastlane·ExportOptions.plist) 설치 (이슈 #131).
// 워크플로우와 달리 사용자가 값을 채워 넣는 파일이라 "없을 때만 생성"한다 — 덮어쓰지 않고 baseline
// 3-way도 적용하지 않는다(copyWorkflows의 secret-backup 경로와 같은 선례). 원본 갱신을 기존 사용자에게
// 전파하는 것은 범위 밖이다.
import { join, posix } from "node:path";
import { existsSync } from "node:fs";
import { copyFileSync } from "../fsutil.js";
import { storeAppFilesFor } from "../flutter-options.js";

const FLUTTER_APP_DIR = "flutter-app"; // payload/flutter-app/

// 이번 실행에서 다룰 파일의 (보고용 상대경로, 원본, 목적지) 목록.
// 대상은 Flutter 타입이 있을 때만이고, 선택된 플랫폼(context.flutterStore, null이면 둘 다)의 파일로 한정한다.
function flutterAppTargets(context, payloadRoot, targetRoot) {
  const { types = [], paths = new Map(), flutterStore = null } = context;
  if (!types.includes("flutter")) return [];
  const flutterRoot = paths.get("flutter") || ".";
  return storeAppFilesFor(flutterStore).map((rel) => ({
    reported: posix.join(flutterRoot, rel),
    src: join(payloadRoot, FLUTTER_APP_DIR, rel),
    dst: join(targetRoot, flutterRoot, rel),
  }));
}

// 읽기 전용 — status/dry-run이 쓴다. 원본 payload는 읽지 않는다.
export function planFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    (existsSync(dst) ? result.kept : result.created).push(reported);
  }
  return result;
}

export function copyFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, src, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    if (existsSync(dst)) { result.kept.push(reported); continue; }
    copyFileSync(src, dst); // 부모 디렉토리 생성 + 바이트 그대로(CRLF 보존)
    result.created.push(reported);
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/flutter-app-copy.test.js
```

예상: 8개 전부 통과.

---

### Task 9: `runFull`에 스토어 워크플로우 정리와 Flutter 앱 파일 복사 연동

**선행 조건:** Task 25·26의 산출물(`payload/flutter-app/android/fastlane/Fastfile.playstore`, `ios/fastlane/Fastfile`, `ios/ExportOptions.plist`)이 **작업 트리에 존재해야 한다**(커밋 여부와 무관 — 이 플랜의 서브에이전트는 커밋하지 않는다). `runFull`이 실제 payload로 `copyFlutterAppFiles`를 호출하므로, 그 파일이 없으면 기존 `tests/node/e2e-matrix.test.js`의 flutter/monorepo 케이스가 `ENOENT`로 깨진다. 이 Task 시작 전에 `ls payload/flutter-app/android/fastlane/Fastfile.playstore payload/flutter-app/ios/fastlane/Fastfile payload/flutter-app/ios/ExportOptions.plist`로 존재를 확인한다. 없으면 Task 25·26을 먼저 실행한다(Task 7·8은 이 파일들과 무관하게 먼저 실행 가능).

**Files:**
- Modify: `src/commands/full.js`
- Test: `tests/node/flutter-full-install.test.js` (신규)

**Interfaces:**
- Consumes (Task 8): `copyFlutterAppFiles(context, payloadRoot, targetRoot) → { created: string[], kept: string[] }`
- Consumes (D1, `src/core/flutter-options.js`): `cleanupDeselectedStoreWorkflows(workflowsDir: string, installedFilenames: string[], stores: string[], baseline: object | null) → { removed: string[], backedUp: string[] }` — baseline의 `files[filename].installed` 해시와 디스크 내용이 같으면(미수정) 삭제, 다르면 `.bak`으로 이름 변경. `stores`에 포함되지 않은 스토어 워크플로우만 대상. Fastfile 등 앱 파일은 다루지 않는다.
- Consumes (Task 7): `context.flutterStore`가 필터를 이미 적용한 `copyWorkflows`
- Produces: `runFull(context, payloadRoot, targetRoot, hooks)` 반환값이 `{ workflows, gitignoreUpdated, unresolved, secrets, cleanup, storeCleanup, flutterApp }`로 확장(계약 §8).
  - `storeCleanup`: `{ removed: string[], backedUp: string[] }`. `context.flutterStore`가 배열이고 `types`에 `flutter`가 있을 때만 정리를 수행, 아니면 `{ removed: [], backedUp: [] }`.
  - `flutterApp`: `copyFlutterAppFiles` 결과(Flutter가 아니면 `{ created: [], kept: [] }`).
  - 로그: `log.info("flutter-app", "create" | "keep", …)`, `log.info("cleanup", "remove" | "backup", …)`.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/node/flutter-full-install.test.js`:

```js
// tests/node/flutter-full-install.test.js
// runFull 통합 (이슈 #131) — 실제 payload로 Flutter 앱 파일 생성과 선택 해제된 스토어 워크플로우 정리를 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFull } from "../../src/commands/full.js";
import { createContext } from "../../src/context.js";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeResolvers } from "../../src/core/detect-fs.js";
import { readBaseline } from "../../src/core/baseline.js";

const WF_DIR = ".github/workflows";
const PLAY = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";
const TESTFLIGHT_TEST = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";
const APP_FILES = ["android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist"];

// sub: Flutter 프로젝트 루트(레포 기준). "."이면 단일 레포, "app"이면 모노레포.
function flutterTarget(sub = ".") {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-full-"));
  mkdirSync(join(target, sub), { recursive: true });
  writeFileSync(join(target, sub, "pubspec.yaml"), "name: fxapp\nversion: 1.0.0+1\n");
  return target;
}

function install(target, { types = ["flutter"], paths = new Map([["flutter", "."]]), flutterStore = null } = {}) {
  return runFull(createContext({
    mode: "full", force: true, types, version: "1.0.0", versionCode: 1,
    branch: "main", branches: { main: "main", develop: "develop", mode: "pr-flow" },
    paths, repoName: "app", resolvers: makeResolvers(target, "app", paths),
    now: "2026-09-21 10:00:00", today: "2026-09-21", templateVersion: "0.10.0", flutterStore,
  }), resolvePayloadRoot(), target);
}

const workflows = (target) => readdirSync(join(target, WF_DIR));

test("신규 설치: Flutter 앱 파일 3개가 만들어지고 created로 보고된다", () => {
  const target = flutterTarget();
  try {
    const r = install(target);
    assert.deepStrictEqual([...r.flutterApp.created].sort(), [...APP_FILES].sort());
    assert.deepStrictEqual(r.flutterApp.kept, []);
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, rel)), rel);
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("기존 파일 유지: 이미 있는 앱 파일은 덮어쓰지 않고 재실행하면 전부 kept다", () => {
  const target = flutterTarget();
  try {
    mkdirSync(join(target, "ios"), { recursive: true });
    writeFileSync(join(target, "ios/ExportOptions.plist"), "내가 채운 값\n");

    const first = install(target);
    assert.deepStrictEqual(first.flutterApp.kept, ["ios/ExportOptions.plist"]);
    assert.strictEqual(readFileSync(join(target, "ios/ExportOptions.plist"), "utf8"), "내가 채운 값\n");

    const second = install(target);
    assert.deepStrictEqual(second.flutterApp.created, []);
    assert.strictEqual(second.flutterApp.kept.length, 3);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("모노레포: Flutter 앱 파일이 paths.flutter 아래에 만들어진다", () => {
  const target = flutterTarget("app");
  try {
    const r = install(target, { paths: new Map([["flutter", "app"]]) });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), APP_FILES.map((rel) => `app/${rel}`).sort());
    for (const rel of APP_FILES) assert.ok(existsSync(join(target, "app", rel)), rel);
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")), "레포 루트에는 만들지 않는다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("Flutter가 아닌 프로젝트: 앱 파일도 정리도 없다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-flutter-full-react-"));
  try {
    writeFileSync(join(target, "package.json"), '{"name":"web","version":"1.0.0"}\n');
    const r = install(target, { types: ["react"], paths: new Map([["react", "."]]), flutterStore: [] });
    assert.deepStrictEqual(r.flutterApp, { created: [], kept: [] });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    assert.ok(!existsSync(join(target, "android")) && !existsSync(join(target, "ios")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("flutterStore가 null이면 이전에 깐 스토어 워크플로우를 지우지 않는다 (현행 동작)", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: null });
    assert.deepStrictEqual(r.storeCleanup, { removed: [], backedUp: [] });
    for (const f of [PLAY, TESTFLIGHT, TESTFLIGHT_TEST]) assert.ok(workflows(target).includes(f), f);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제: 손대지 않은 iOS 워크플로우는 삭제하고 Fastfile·ExportOptions는 남긴다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: ["android"] });

    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.storeCleanup.backedUp, []);
    const files = workflows(target);
    assert.ok(files.includes(PLAY));
    assert.ok(!files.includes(TESTFLIGHT) && !files.includes(TESTFLIGHT_TEST));
    assert.ok(!files.some((f) => f.endsWith(".bak")), "미수정이면 .bak 없이 깔끔히 삭제");
    // 사용자 소유 파일은 삭제하지 않는다
    assert.ok(existsSync(join(target, "ios/fastlane/Fastfile")));
    assert.ok(existsSync(join(target, "ios/ExportOptions.plist")));
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제: 사용자가 수정한 워크플로우는 지우지 않고 .bak으로 보존한다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const p = join(target, WF_DIR, TESTFLIGHT);
    writeFileSync(p, readFileSync(p, "utf8") + "\n# 내가 고친 부분\n");

    const r = install(target, { flutterStore: ["android"] });
    assert.deepStrictEqual(r.storeCleanup.backedUp, [TESTFLIGHT]);
    assert.deepStrictEqual(r.storeCleanup.removed, [TESTFLIGHT_TEST]);
    assert.match(readFileSync(`${p}.bak`, "utf8"), /내가 고친 부분/);
    assert.ok(!workflows(target).includes(TESTFLIGHT), "트리거는 죽어야 한다");
    assert.strictEqual(r.gitignoreUpdated, true, ".bak이 생겼으므로 .gitignore 갱신 대상이다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("선택 해제한 파일은 baseline에서도 빠져 다음 실행에서 '사용자가 지웠다'로 오인되지 않는다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    install(target, { flutterStore: ["android"] });
    const files = readBaseline(target).files;
    assert.ok(!(TESTFLIGHT in files) && !(TESTFLIGHT_TEST in files));
    assert.ok(PLAY in files);

    const again = install(target, { flutterStore: ["android"] });
    assert.deepStrictEqual(again.storeCleanup, { removed: [], backedUp: [] });
    assert.deepStrictEqual(again.workflows.removedKept, []);
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("스토어 대상을 none([])으로 바꾸면 스토어 워크플로우가 전부 정리되고 앱 파일은 새로 만들지 않는다", () => {
  const target = flutterTarget();
  try {
    install(target, { flutterStore: ["android", "ios"] });
    const r = install(target, { flutterStore: [] });
    assert.deepStrictEqual([...r.storeCleanup.removed].sort(), [PLAY, TESTFLIGHT, TESTFLIGHT_TEST].sort());
    assert.deepStrictEqual(r.flutterApp.created, []);
    assert.deepStrictEqual(r.flutterApp.kept, [], "none이면 대상 자체가 없다");
    assert.ok(existsSync(join(target, "android/fastlane/Fastfile.playstore")), "이미 만든 사용자 파일은 남긴다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("신규 설치에서 flutterStore [ios]만 고르면 iOS 앱 파일만 만들어진다", () => {
  const target = flutterTarget();
  try {
    const r = install(target, { flutterStore: ["ios"] });
    assert.deepStrictEqual([...r.flutterApp.created].sort(), ["ios/ExportOptions.plist", "ios/fastlane/Fastfile"]);
    assert.ok(!existsSync(join(target, "android")));
    assert.ok(!workflows(target).includes(PLAY));
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/flutter-full-install.test.js
```

예상: `r.flutterApp`이 `undefined`라 `Cannot read properties of undefined (reading 'created')`로 첫 테스트부터 실패. "선택 해제" 계열은 `r.storeCleanup`이 없어 실패.

- [ ] **Step 3: 최소 구현**

`src/commands/full.js`를 다음과 같이 수정한다.

3-1. import — 기존 `copyScripts` import 다음 줄들 근처에 두 줄 추가:

기존:

```js
import { copyScripts } from "../core/copy/simple.js";
```

변경:

```js
import { copyScripts } from "../core/copy/simple.js";
import { copyFlutterAppFiles } from "../core/copy/flutter-app.js";
```

기존:

```js
import { cleanupOtherDeployWorkflows, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";
```

변경:

```js
import { cleanupOtherDeployWorkflows, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";
import { cleanupDeselectedStoreWorkflows } from "../core/flutter-options.js";
```

3-2. Flutter 앱 파일 복사 — 1단계(워크플로우 복사) 직후에 삽입.

기존:

```js
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>
```

변경(두 줄 뒤에 블록 추가):

```js
  const wfCounters = copyWorkflows(context, payloadRoot, targetRoot, hooks);
  const deployValues = wfCounters.deployValues || new Map(); // Map<type, Map<key,value>>

  // 1-1. Flutter 앱 파일(fastlane·ExportOptions) — 사용자가 값을 채워 쓰는 파일이라 없을 때만 만든다.
  //      워크플로우 복사가 끝난 뒤에 실행한다(워크플로우가 이 파일들을 전제로 돈다).
  const flutterApp = copyFlutterAppFiles(context, payloadRoot, targetRoot);
  for (const f of flutterApp.created) log.info("flutter-app", "create", f);
  for (const f of flutterApp.kept) log.info("flutter-app", "keep", `${f} (기존 파일 유지)`);
```

3-3. 스토어 워크플로우 정리 — 기존 `cleanupOtherDeployWorkflows` 블록(`for (const f of cleanup.backedUp || []) log.info(...)` 줄)과 `const gitignoreUpdated = …` 줄 사이에 삽입하고, `gitignoreUpdated` 줄을 확장한다.

기존:

```js
  for (const f of cleanup.removed || []) log.info("cleanup", "remove", `${f} (이전 배포 방식 정리)`);
  for (const f of cleanup.backedUp || []) log.info("cleanup", "backup", `${f} → ${f}.bak`);
  const gitignoreUpdated = gitignoreUpdated0 || cleanup.backedUp.length > 0;
```

변경:

```js
  for (const f of cleanup.removed || []) log.info("cleanup", "remove", `${f} (이전 배포 방식 정리)`);
  for (const f of cleanup.backedUp || []) log.info("cleanup", "backup", `${f} → ${f}.bak`);

  // 6-1. 선택 해제된 스토어 워크플로우 정리 — 스토어 대상을 줄여 재설치하면 이전 워크플로우가 남아
  //      main push마다 계속 도는 것을 막는다. 규칙은 6과 같다(미수정 삭제, 수정본 .bak).
  //      선택이 미결정(null)이거나 Flutter가 없으면 현행 동작 그대로 아무것도 지우지 않는다.
  //      Fastfile·ExportOptions는 사용자 소유라 여기서 다루지 않는다.
  const workflowsDir = join(targetRoot, PATHS.workflowsDir);
  const storeCleanup = Array.isArray(context.flutterStore) && types.includes("flutter")
    ? cleanupDeselectedStoreWorkflows(
      workflowsDir,
      existsSync(workflowsDir) ? readdirSync(workflowsDir) : [],
      context.flutterStore,
      previousBaseline)
    : { removed: [], backedUp: [] };
  for (const f of [...storeCleanup.removed, ...storeCleanup.backedUp]) delete previousBaseline?.files?.[f];
  for (const f of storeCleanup.removed) log.info("cleanup", "remove", `${f} (선택 해제된 스토어 워크플로우 정리)`);
  for (const f of storeCleanup.backedUp) log.info("cleanup", "backup", `${f} → ${f}.bak`);

  const gitignoreUpdated = gitignoreUpdated0 || cleanup.backedUp.length > 0 || storeCleanup.backedUp.length > 0;
```

(이 파일 뒤쪽 8단계에는 이미 `const wfDir = join(targetRoot, PATHS.workflowsDir)`가 있다. 이름이 달라(`workflowsDir` vs `wfDir`) 충돌하지 않는다. 기존 코드는 손대지 않는다.)

3-4. 반환값 확장.

기존:

```js
  return { workflows: wfCounters, gitignoreUpdated, unresolved, secrets, cleanup };
```

변경:

```js
  return { workflows: wfCounters, gitignoreUpdated, unresolved, secrets, cleanup, storeCleanup, flutterApp };
```

3-5. 파일 상단 순서 주석 갱신 — 기존 `// 복사 순서: workflows(+env 치환) → version.yml → readme → scripts → gitignore(조건부)` 줄을 다음으로 교체:

```js
// 복사 순서: workflows(+env 치환) → flutter 앱 파일 → version.yml → readme → scripts → gitignore(조건부)
```

- [ ] **Step 4: 통과 확인 (신규 + 회귀)**

```bash
node --test tests/node/flutter-full-install.test.js tests/node/deploy-style.test.js tests/node/e2e-matrix.test.js tests/node/flutter-app-copy.test.js tests/node/flutter-store-filter.test.js
```

예상: 전부 통과. `deploy-style`의 `cleanup` 검증과 `e2e-matrix` flutter/monorepo 케이스가 회귀 방어선이다(`flutterStore`가 `null`이므로 정리는 건너뛰고 앱 파일은 실제 payload에서 생성된다). 전체 스위트는 Task 27에서 실행한다.

### Task 10: 프롬프트 — 환경변수 방식·스토어 배포 대상·배포 모드 선택과 수정 메뉴 항목

Flutter 타입일 때만 쓰이는 선택 함수 3개와, `store_submit` 경고 문구를 돌려주는 순수 함수, 수정 메뉴 항목 목록(순수 함수로 분리)을 `src/ui/prompts.js`에 추가한다. 이 Task는 커밋하지 않는다(오케스트레이터가 일괄 처리).

**Files:**
- Modify: `src/ui/prompts.js` (import 1줄 추가, `editMenu` 교체, `selectDeployStyle` 뒤에 신규 함수 추가)
- Create: `tests/node/prompts-flutter.test.js`

**Interfaces:**
- Consumes (D1 `src/core/flutter-options.js`): `ENV_MODES`, `DEFAULT_ENV_MODE`, `STORE_PLATFORMS`, `DEPLOY_MODES`, `DEFAULT_DEPLOY_MODE`
- Produces (`src/ui/prompts.js`):
  - `selectEnvMode({ initialValue = DEFAULT_ENV_MODE } = {}) → Promise<"dart-define"|"dotenv"|CANCEL>`
  - `selectFlutterStores({ initialValues = [] } = {}) → Promise<string[]|CANCEL>` (multiselect, 아무것도 안 고르면 `[]`)
  - `selectDeployMode({ platform, initialValue = DEFAULT_DEPLOY_MODE }) → Promise<"store_only"|"store_prepare"|"store_submit"|CANCEL>` (`platform`은 `"android"|"ios"`)
  - `deployModeWarning(mode) → string` (`store_submit`이면 경고 한 줄, 아니면 `""`)
  - `editMenuOptions({ showOptional = false, showFlutter = false } = {}) → Array<{value,label}>`
  - `editMenu({ showOptional = false, showFlutter = false } = {})` — 기존 시그니처의 확장, 수정 메뉴 값 `envMode` / `flutterStore` / `deployMode` 추가

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/prompts-flutter.test.js` 신규

```js
// tests/node/prompts-flutter.test.js
// 이슈 #131 — Flutter 마법사 선택지 3개(환경변수 방식·스토어 배포 대상·배포 모드)와 수정 메뉴 항목.
// node --test 실행 환경은 stdin이 TTY가 아니므로 readline-engine이 initialIndex/initialValues를
// 그대로 돌려준다 — "질문 없이 넘어갈 때의 값"이 곧 각 함수의 기본값이다.
import { test } from "node:test";
import assert from "node:assert";
import {
  selectEnvMode, selectFlutterStores, selectDeployMode, deployModeWarning, editMenuOptions,
} from "../../src/ui/prompts.js";

test("selectEnvMode: 초기값이 없으면 신규 설치 기본값인 dart-define을 반환한다", async () => {
  assert.strictEqual(await selectEnvMode(), "dart-define");
});

test("selectEnvMode: initialValue(현재값)를 커서 초기 위치로 존중한다", async () => {
  assert.strictEqual(await selectEnvMode({ initialValue: "dotenv" }), "dotenv");
  assert.strictEqual(await selectEnvMode({ initialValue: "dart-define" }), "dart-define");
});

test("selectFlutterStores: 초기 선택이 없으면 빈 배열(스토어 배포 안 함)을 반환한다", async () => {
  assert.deepStrictEqual(await selectFlutterStores(), []);
});

test("selectFlutterStores: initialValues(기존 설치에서 추론한 플랫폼)를 그대로 초기 선택으로 쓴다", async () => {
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["ios"] }), ["ios"]);
  assert.deepStrictEqual(await selectFlutterStores({ initialValues: ["android", "ios"] }), ["android", "ios"]);
});

test("selectDeployMode: 기본값은 store_only이고 플랫폼별로 initialValue를 존중한다", async () => {
  assert.strictEqual(await selectDeployMode({ platform: "android" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "ios" }), "store_only");
  assert.strictEqual(await selectDeployMode({ platform: "android", initialValue: "store_prepare" }), "store_prepare");
  assert.strictEqual(await selectDeployMode({ platform: "ios", initialValue: "store_submit" }), "store_submit");
});

test("deployModeWarning: store_submit만 'main push마다 심사가 자동 제출' 경고를 돌려준다", () => {
  assert.ok(deployModeWarning("store_submit").includes("main push마다 심사가 자동 제출"));
  assert.strictEqual(deployModeWarning("store_only"), "");
  assert.strictEqual(deployModeWarning("store_prepare"), "");
  assert.strictEqual(deployModeWarning(undefined), "");
});

test("editMenuOptions: showFlutter가 꺼져 있으면 Flutter 항목이 없다 (기존 동작 그대로)", () => {
  const values = (opts) => editMenuOptions(opts).map((o) => o.value);
  assert.deepStrictEqual(values({}), ["type", "version", "branch", "done"]);
  assert.deepStrictEqual(values({ showOptional: true }), ["type", "version", "branch", "nexus", "secret", "done"]);
});

test("editMenuOptions: showFlutter면 '모두 맞음' 바로 앞에 환경변수 방식·스토어 배포 대상·배포 모드가 붙는다", () => {
  const options = editMenuOptions({ showOptional: true, showFlutter: true });
  assert.deepStrictEqual(options.map((o) => o.value),
    ["type", "version", "branch", "nexus", "secret", "envMode", "flutterStore", "deployMode", "done"]);
  assert.deepStrictEqual(
    options.filter((o) => ["envMode", "flutterStore", "deployMode"].includes(o.value)).map((o) => o.label),
    ["환경변수 방식", "스토어 배포 대상", "배포 모드"]);
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/prompts-flutter.test.js
```
예상: 실패 — `SyntaxError: The requested module '../../src/ui/prompts.js' does not provide an export named 'selectEnvMode'` (모듈 로드 단계에서 전체 테스트 파일이 실패).

- [ ] **Step 3: 최소 구현** — `src/ui/prompts.js`

(3-a) 5행 `import { DEPLOY_STYLES, NO_DEPLOY_STYLE } from "../core/deploy-style.js";` 바로 아래에 추가:

```js
import { ENV_MODES, DEFAULT_ENV_MODE, STORE_PLATFORMS, DEPLOY_MODES, DEFAULT_DEPLOY_MODE } from "../core/flutter-options.js";
```

(3-b) 기존 `editMenu` 함수 전체(주석 `// 수정 메뉴 — 어떤 항목을 고칠지. …`부터 함수 끝까지)를 다음으로 교체:

```js
// 수정 메뉴 항목 — showOptional=full/workflows에서만 nexus/secret 노출,
// showFlutter=Flutter 타입일 때만 환경변수 방식/스토어 배포 대상/배포 모드 노출 (이슈 #131).
// 라벨·순서를 테스트할 수 있도록 순수 함수로 분리했다.
export function editMenuOptions({ showOptional = false, showFlutter = false } = {}) {
  const options = [
    { value: "type", label: "프로젝트 타입" },
    { value: "version", label: "버전" },
    { value: "branch", label: "기본 브랜치" },
  ];
  if (showOptional) {
    options.push({ value: "nexus", label: "Nexus publish 포함 여부" });
    options.push({ value: "secret", label: "Secret 백업 포함 여부" });
  }
  if (showFlutter) {
    options.push({ value: "envMode", label: "환경변수 방식" });
    options.push({ value: "flutterStore", label: "스토어 배포 대상" });
    options.push({ value: "deployMode", label: "배포 모드" });
  }
  options.push({ value: "done", label: "모두 맞음, 계속" });
  return options;
}

// 수정 메뉴 — 어떤 항목을 고칠지.
export async function editMenu({ showOptional = false, showFlutter = false } = {}) {
  return engine.select({ message: "어떤 항목을 수정할까요?", options: editMenuOptions({ showOptional, showFlutter }) });
}
```

(3-c) `selectDeployStyle` 함수 끝(`}`) 다음, `// 브랜치 전략 선택 (이슈 #93).` 주석 바로 앞에 추가:

```js
// ── Flutter 옵션 (이슈 #131) ─────────────────────────────────────────
// 프로젝트 타입에 flutter가 포함된 경우에만 interactive.js가 묻는다. 세 함수 모두 취소(ESC) 시 CANCEL을
// 그대로 돌려주고, "ESC = 기본값" 처리는 호출부가 한다 (selectDeployStyle과 같은 규약).
const ENV_MODE_LABELS = {
  "dart-define": "dart-define (신규 설치 기본) — 시크릿을 --dart-define-from-file로 빌드에 전달, 프로젝트에 .env를 만들지 않음",
  dotenv: "dotenv — Flutter 루트에 .env를 만들어 flutter_dotenv·envied가 읽음 (기존 설치 유지값)",
};

const STORE_LABELS = {
  android: "Android — Google Play Store (fastlane)",
  ios: "iOS — TestFlight / App Store Connect (fastlane)",
};

const DEPLOY_MODE_LABELS = {
  android: {
    store_only: "store_only — internal 트랙에 업로드 (기본)",
    store_prepare: "store_prepare — production 트랙에 draft로 업로드 (Play Console에서 직접 출시)",
    store_submit: "store_submit — production 심사 제출까지",
  },
  ios: {
    store_only: "store_only — TestFlight 업로드 (기본)",
    store_prepare: "store_prepare — 앱 버전·메타데이터 준비까지 (심사 제출 안 함)",
    store_submit: "store_submit — 심사 제출까지",
  },
};

const PLATFORM_TITLES = { android: "Android (Play Store)", ios: "iOS (TestFlight)" };

// 환경변수 방식 — 시크릿 ENV_FILE(.env 형식)을 Flutter 빌드에 넘기는 방법.
export async function selectEnvMode({ initialValue = DEFAULT_ENV_MODE } = {}) {
  engine.note(
    "시크릿 ENV_FILE(.env 형식)을 Flutter 빌드에 넘기는 방식입니다.\n" +
    "dart-define은 String.fromEnvironment로 읽고, dotenv는 flutter_dotenv·envied가 .env 파일을 읽습니다.\n" +
    "나중에 확인 화면의 '수정하기 > 환경변수 방식'에서 바꿀 수 있습니다.",
    "환경변수 방식",
  );
  return engine.select({
    message: "Flutter 환경변수는 어떤 방식으로 넘길까요?",
    options: ENV_MODES.map((value) => ({ value, label: ENV_MODE_LABELS[value] })),
    initialIndex: Math.max(0, ENV_MODES.indexOf(initialValue)),
  });
}

// 스토어 배포 대상 — 고른 플랫폼의 워크플로우와 fastlane 템플릿만 설치한다. 아무것도 안 고르면 스토어 배포 없이 설치.
export async function selectFlutterStores({ initialValues = [] } = {}) {
  engine.note(
    "고른 플랫폼의 스토어 배포 워크플로우와 fastlane 파일(Fastfile 등)만 설치합니다.\n" +
    "아무것도 고르지 않으면 스토어 배포 없이 설치합니다 (Firebase·Selfhosted·Test APK·CI는 항상 설치).",
    "스토어 배포 대상",
  );
  return engine.multiselect({
    message: "스토어에 배포할 플랫폼을 선택하세요 (Space 토글, Enter 확정)",
    options: STORE_PLATFORMS.map((value) => ({ value, label: STORE_LABELS[value] })),
    initialValues,
    required: false,
  });
}

// 배포 모드 — 플랫폼별로 한 번씩 묻는다. 런타임의 저장소 변수와 workflow_dispatch 입력이 항상 이 값보다 우선한다.
export async function selectDeployMode({ platform, initialValue = DEFAULT_DEPLOY_MODE }) {
  return engine.select({
    message: `${PLATFORM_TITLES[platform]} 배포 모드를 선택하세요`,
    options: DEPLOY_MODES.map((value) => ({ value, label: DEPLOY_MODE_LABELS[platform][value] })),
    initialIndex: Math.max(0, DEPLOY_MODES.indexOf(initialValue)),
  });
}

// store_submit은 main push마다 심사를 제출하므로 고른 직후 한 줄로 알린다. 호출부(interactive)가 note로 출력한다.
export function deployModeWarning(mode) {
  return mode === "store_submit" ? "store_submit을 고르면 main push마다 심사가 자동 제출됩니다." : "";
}
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/prompts-flutter.test.js tests/node/prompts-branch-strategy.test.js
```
예상: 전부 pass (기존 `prompts-branch-strategy` 포함).

---

### Task 11: 대화형 마법사 — Flutter 질문 흐름·저장값 재질문 생략·기존 설치 추론·수정하기 루프

질문 흐름은 새 모듈 `src/commands/interactive-flutter.js`(상태를 불변 객체로 주고받는 순수 로직)로 분리하고, `interactive.js`는 호출만 한다. 저장값이 없는 기존 설치의 스토어 초기 선택은 설치된 스토어 워크플로우 파일명으로 추론하는 `inferInstalledStores`(신규 `src/core/installed-stores.js`, Task 13 doctor도 사용)를 쓴다. 이 Task는 커밋하지 않는다.

**Files:**
- Create: `src/core/installed-stores.js`
- Create: `src/commands/interactive-flutter.js`
- Modify: `src/commands/interactive.js`
- Create: `tests/node/installed-stores.test.js`
- Create: `tests/node/interactive-flutter.test.js`

**Interfaces:**
- Consumes (D1 `src/core/flutter-options.js`): `isEnvMode`, `isDeployMode`, `parseStoreList`, `STORE_PLATFORMS`, `STORE_WORKFLOWS`, `DEFAULT_DEPLOY_MODE`, `resolveFlutterOptions({ cli, existing })`(환경변수 초기값 결정)
- Consumes (D1 `src/core/detect-fs.js`): `makeResolvers(root, repoName, paths, flutterOptions = null)`
- Consumes (D1 `parseExisting().options`): `envMode`(string|null), `flutterStore`(string|null 원문), `androidDeployMode`, `iosDeployMode`
- Consumes (D1 `createContext`): 필드 `envMode`, `flutterStore`, `androidDeployMode`, `iosDeployMode`
- Consumes (D2): `runFull` 반환 `{ storeCleanup, flutterApp }`, `context.flutterStore` 기반 스토어 필터·정리, `src/ui/env-plan.js`의 `promptEnvPlan({ …, flutterStore })` 옵션(D2 Task 7b)
- Consumes (Task 10): `io.selectEnvMode`, `io.selectFlutterStores`, `io.selectDeployMode`, `io.editMenu({showOptional, showFlutter})`, `deployModeWarning`
- Produces:
  - `src/core/installed-stores.js`: `inferInstalledStores(workflowsDir) → string[]` (`STORE_PLATFORMS` 순서, 스토어 워크플로우 파일이 하나라도 있으면 그 플랫폼 포함, 폴더 없으면 `[]`)
  - `src/commands/interactive-flutter.js`:
    - `FLUTTER_EDIT_ITEMS: Set<"envMode"|"flutterStore"|"deployMode">`
    - `savedFlutterState(existing) → { envMode: string, stores: string[]|null, androidDeployMode: string, iosDeployMode: string }` (`""`/`null` = 미결정)
    - `askUnsetFlutterOptions(io, state, { envModeDefault, inferredStores }) → Promise<state>` (미결정 값만 묻는다, ESC = 기본값)
    - `editFlutterOption(io, what, state, envModeDefault) → Promise<state>` (ESC = 현재값 유지)
  - `io.summary(...)` 인자에 `storeCleanup`, `flutterApp` 추가 전달 (소비는 Task 14)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/installed-stores.test.js` 신규:

```js
// tests/node/installed-stores.test.js
// 이슈 #131 — flutter_store 저장값이 없는 기존 설치는 설치된 스토어 워크플로우로 플랫폼을 추론한다.
// (선택 해제로 오인해 잘 쓰던 스토어 워크플로우가 정리되는 사고를 막는다.)
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inferInstalledStores } from "../../src/core/installed-stores.js";

function workflowsDirWith(files) {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-"));
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "");
  return { root, dir };
}

test("inferInstalledStores: 스토어 워크플로우 파일명으로 설치된 플랫폼을 추론한다", () => {
  const { root, dir } = workflowsDirWith(["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), ["ios"]);
    writeFileSync(join(dir, "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"), "");
    assert.deepStrictEqual(inferInstalledStores(dir), ["android", "ios"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: 스토어와 무관한 Flutter 워크플로우만 있으면 빈 배열", () => {
  const { root, dir } = workflowsDirWith([
    "PROJECT-FLUTTER-CI.yaml", "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml", "PROJECT-COMMON-VERSION-CONTROL.yaml",
  ]);
  try {
    assert.deepStrictEqual(inferInstalledStores(dir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inferInstalledStores: 워크플로우 폴더가 없으면 빈 배열", () => {
  const root = mkdtempSync(join(tmpdir(), "paw-installed-stores-empty-"));
  try {
    assert.deepStrictEqual(inferInstalledStores(join(root, ".github", "workflows")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

`tests/node/interactive-flutter.test.js` 신규:

```js
// tests/node/interactive-flutter.test.js
// 이슈 #131 — 프로젝트 타입에 flutter가 있을 때만 환경변수 방식·스토어 배포 대상·배포 모드를 묻고,
// 저장값이 있으면 재질문하지 않으며, 기존 설치는 설치된 스토어 워크플로우로 초기 선택을 추론한다.
// 스텁 io 방식은 interactive-branch-strategy.test.js와 같다. 답변은 version.yml(저장)과
// 설치된 워크플로우 파일(스토어 필터)로 검증한다.
import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInteractive } from "../../src/commands/interactive.js";

const CANCEL = Symbol("cancel");
const WF_DIR = ".github/workflows";
const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const IOS_WORKFLOWS = ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"];

const initialOf = (arg) => arg.initialValue;
const initialsOf = (arg) => arg.initialValues;

// envMode/stores/deployMode: (arg) => 답변. 기본은 "질문의 초기값 그대로 Enter".
function stubIo({ envMode = initialOf, stores = initialsOf, deployMode = initialOf, confirmProjectMenu, editMenu, selectTypes } = {}) {
  const calls = { envMode: [], stores: [], deployMode: [], editMenu: [], notes: [] };
  const io = {
    selectMode: async () => "full",
    confirmProjectMenu: confirmProjectMenu ?? (async () => "continue"),
    confirmTypes: async ({ types }) => types,
    selectDeployStyle: async () => "simple",
    selectBranchStrategy: async () => "pr-flow",
    askYesNo: async (_message, def) => def,
    askText: async (_message, def) => def,
    note: (text, title) => calls.notes.push({ text, title }),
    cancelMessage: () => {},
    summary: () => {},
    outro: () => {},
    editMenu: async (arg) => { calls.editMenu.push(arg); return editMenu ? editMenu(calls.editMenu.length) : "done"; },
    selectTypes,
    selectEnvMode: async (arg) => { calls.envMode.push(arg); return envMode(arg); },
    selectFlutterStores: async (arg) => { calls.stores.push(arg); return stores(arg); },
    selectDeployMode: async (arg) => { calls.deployMode.push(arg); return deployMode(arg); },
  };
  return { io, calls };
}

function flutterProject() {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-"));
  writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+1\n");
  return target;
}

const versionYml = (target) => readFileSync(join(target, "version.yml"), "utf8");
const workflowExists = (target, name) => existsSync(join(target, WF_DIR, name));
const neverAsked = () => { throw new Error("이 질문은 나오면 안 된다"); };

test("신규 설치: 환경변수 방식·스토어·배포 모드를 묻고 선택을 version.yml과 워크플로우 설치에 반영한다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => "dotenv", stores: () => ["android"], deployMode: () => "store_prepare" });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dart-define" }], "신규 설치의 환경변수 초기 선택은 dart-define");
    assert.deepStrictEqual(calls.stores, [{ initialValues: [] }], "신규 설치의 스토어 초기 선택은 없음");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "android", initialValue: "store_only" }], "고른 플랫폼(android)만 배포 모드를 묻는다");

    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /flutter_store:\s*"?android"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_prepare"?/);
    assert.ok(workflowExists(target, PLAYSTORE));
    for (const f of IOS_WORKFLOWS) assert.ok(!workflowExists(target, f), `${f}는 선택 해제라 설치되지 않아야 한다`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("저장값이 있으면 다시 실행해도 재질문하지 않는다 (deploy_style과 같은 규약)", async () => {
  const target = flutterProject();
  try {
    const first = stubIo({ envMode: () => "dotenv", stores: () => ["android", "ios"], deployMode: (a) => (a.platform === "ios" ? "store_submit" : "store_only") });
    await runInteractive({}, { cwd: target, io: first.io });

    const second = stubIo({ envMode: neverAsked, stores: neverAsked, deployMode: neverAsked });
    assert.strictEqual(await runInteractive({}, { cwd: target, io: second.io }), 0);
    assert.deepStrictEqual([second.calls.envMode, second.calls.stores, second.calls.deployMode], [[], [], []]);

    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /flutter_store:\s*"?android,ios"?/);
    assert.match(vy, /ios_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("저장값 없는 기존 설치: dotenv를 초기 선택으로, 스토어는 설치된 워크플로우(iOS)로 추론한다", async () => {
  const target = flutterProject();
  try {
    // 이 기능 이전에 설치된 프로젝트 — version.yml에 옵션 저장값이 없고 iOS 스토어 워크플로우가 깔려 있다.
    writeFileSync(join(target, "version.yml"), 'version: "1.0.0"\nversion_code: 1\nproject_types: ["flutter"]\n');
    mkdirSync(join(target, WF_DIR), { recursive: true });
    writeFileSync(join(target, WF_DIR, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "# 기존 설치본\n");

    const { io, calls } = stubIo();
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.envMode, [{ initialValue: "dotenv" }], "기존 설치는 동작 보존을 위해 dotenv가 초기 선택");
    assert.deepStrictEqual(calls.stores, [{ initialValues: ["ios"] }], "설치된 IOS-TESTFLIGHT로 iOS를 초기 선택");
    assert.deepStrictEqual(calls.deployMode, [{ platform: "ios", initialValue: "store_only" }]);
    assert.match(versionYml(target), /flutter_store:\s*"?ios"?/);
    assert.ok(workflowExists(target, "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"), "추론된 iOS 워크플로우가 정리되면 안 된다");
    assert.ok(!workflowExists(target, PLAYSTORE), "선택하지 않은 Android 스토어 워크플로우는 새로 설치되지 않는다");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("ESC(취소)는 기본값: dart-define, 스토어 없음(none), 배포 모드는 묻지 않는다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ envMode: () => CANCEL, stores: () => CANCEL, deployMode: neverAsked });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.deployMode, []);
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dart-define"?/);
    assert.match(vy, /flutter_store:\s*"?none"?/);
    for (const f of [PLAYSTORE, ...IOS_WORKFLOWS]) assert.ok(!workflowExists(target, f), `${f}는 설치되지 않아야 한다`);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("store_submit을 고르면 main push마다 심사가 자동 제출된다는 경고 note가 나온다", async () => {
  const target = flutterProject();
  try {
    const { io, calls } = stubIo({ stores: () => ["ios"], deployMode: () => "store_submit" });
    await runInteractive({}, { cwd: target, io });
    const warning = calls.notes.find((n) => n.title === "배포 모드");
    assert.ok(warning, "배포 모드 경고 note가 있어야 한다");
    assert.ok(warning.text.includes("main push마다 심사가 자동 제출"));
    assert.match(versionYml(target), /ios_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("수정하기: Flutter 프로젝트면 환경변수 방식·배포 모드 항목이 노출되고 현재값을 초기값으로 다시 묻는다", async () => {
  const target = flutterProject();
  try {
    let menuRound = 0;
    let envCalls = 0;
    let modeCalls = 0;
    const { io, calls } = stubIo({
      envMode: (arg) => (++envCalls === 1 ? arg.initialValue : "dotenv"),
      stores: () => ["android"],
      deployMode: (arg) => (++modeCalls === 1 ? arg.initialValue : "store_submit"),
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => ["envMode", "deployMode", "done"][round - 1],
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);

    assert.deepStrictEqual(calls.editMenu[0], { showOptional: true, showFlutter: true });
    assert.deepStrictEqual(calls.envMode[1], { initialValue: "dart-define" }, "수정 시 초기값은 현재값");
    assert.deepStrictEqual(calls.deployMode[1], { platform: "android", initialValue: "store_only" });
    const vy = versionYml(target);
    assert.match(vy, /env_mode:\s*"?dotenv"?/);
    assert.match(vy, /android_deploy_mode:\s*"?store_submit"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("Flutter가 아닌 프로젝트는 Flutter 질문이 전혀 나오지 않고 수정 메뉴에도 항목이 없다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-basic-"));
  try {
    const { io, calls } = stubIo({ envMode: neverAsked, stores: neverAsked, deployMode: neverAsked });
    let menuRound = 0;
    io.confirmProjectMenu = async () => (++menuRound === 1 ? "edit" : "continue");
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.deepStrictEqual(calls.editMenu[0], { showOptional: true, showFlutter: false });
    assert.deepStrictEqual([calls.envMode, calls.stores, calls.deployMode], [[], [], []]);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("편집 루프에서 뒤늦게 flutter 타입을 추가해도 확인 화면 이후 옵션을 한 번 묻는다", async () => {
  const target = mkdtempSync(join(tmpdir(), "paw-interactive-flutter-late-"));
  try {
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "sample-app", version: "1.0.0" }));
    let menuRound = 0;
    const { io, calls } = stubIo({
      confirmProjectMenu: async () => (++menuRound === 1 ? "edit" : "continue"),
      editMenu: (round) => (round === 1 ? "type" : "done"),
      selectTypes: async () => {
        writeFileSync(join(target, "pubspec.yaml"), "name: sample_app\nversion: 1.0.0+1\n");
        return ["flutter"];
      },
    });
    assert.strictEqual(await runInteractive({}, { cwd: target, io }), 0);
    assert.strictEqual(calls.envMode.length, 1);
    assert.strictEqual(calls.stores.length, 1);
    assert.match(versionYml(target), /env_mode:\s*"?dart-define"?/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/installed-stores.test.js tests/node/interactive-flutter.test.js
```
예상: `installed-stores.test.js`는 `Cannot find module '.../src/core/installed-stores.js'`로 실패. `interactive-flutter.test.js`는 `calls.envMode`가 `[]`라 `Expected values to be strictly deep-equal` 실패(질문 자체가 나오지 않음). (전제: D1·D2 구현 완료 — `src/core/flutter-options.js`, version.yml 렌더, 스토어 필터.)

- [ ] **Step 3: 최소 구현**

(3-a) `src/core/installed-stores.js` 신규:

```js
// 이미 설치된 스토어 배포 워크플로우 파일명으로 플랫폼을 추론한다 (이슈 #131).
// version.yml에 flutter_store 저장값이 없는 기존 설치가 대상이다 — 저장값이 없다고 "선택 없음"으로 보면
// 잘 쓰던 스토어 워크플로우가 선택 해제 정리 규칙에 의해 삭제된다.
import { existsSync, readdirSync } from "node:fs";
import { STORE_PLATFORMS, STORE_WORKFLOWS } from "./flutter-options.js";

// 반환: 스토어 워크플로우가 하나라도 설치된 플랫폼 (STORE_PLATFORMS 순서).
export function inferInstalledStores(workflowsDir) {
  if (!existsSync(workflowsDir)) return [];
  const installed = new Set(readdirSync(workflowsDir));
  return STORE_PLATFORMS.filter((platform) => STORE_WORKFLOWS[platform].some((file) => installed.has(file)));
}
```

(3-b) `src/commands/interactive-flutter.js` 신규:

```js
// 대화형 마법사의 Flutter 옵션 질문 (이슈 #131) — 환경변수 방식 · 스토어 배포 대상 · 배포 모드.
// 상태는 { envMode, stores, androidDeployMode, iosDeployMode } 불변 객체로 주고받는다.
//   envMode·*DeployMode의 ""와 stores의 null = 미결정 (stores의 빈 배열 = "스토어 배포 안 함"으로 이미 결정됨).
// 이미 결정된 값은 다시 묻지 않는다 (version.yml 저장값 재질문 생략 규약). ESC(취소)는 항상 기본값:
// 처음 묻는 질문이면 기본값, 수정 중이면 현재값을 유지한다.
import {
  isEnvMode, isDeployMode, parseStoreList, STORE_PLATFORMS, DEFAULT_DEPLOY_MODE,
} from "../core/flutter-options.js";
import { deployModeWarning } from "../ui/prompts.js";

export const FLUTTER_EDIT_ITEMS = new Set(["envMode", "flutterStore", "deployMode"]);

const DEPLOY_MODE_KEY = { android: "androidDeployMode", ios: "iosDeployMode" };

// STORE_PLATFORMS 순서로 정렬하고 모르는 값은 버린다 — 플랫폼별 질문 순서를 고정한다.
const normalizeStores = (picked) => STORE_PLATFORMS.filter((platform) => picked.includes(platform));

// 기존 version.yml의 저장값을 상태로 옮긴다. 잘못된 값은 저장이 없는 것으로 보고 다시 묻는다.
export function savedFlutterState(existing) {
  const options = existing?.options ?? {};
  return {
    envMode: isEnvMode(options.envMode) ? options.envMode : "",
    stores: options.flutterStore == null ? null : parseStoreList(options.flutterStore),
    androidDeployMode: isDeployMode(options.androidDeployMode) ? options.androidDeployMode : "",
    iosDeployMode: isDeployMode(options.iosDeployMode) ? options.iosDeployMode : "",
  };
}

async function askDeployMode(io, platform, initialValue) {
  const picked = await io.selectDeployMode({ platform, initialValue });
  const mode = isDeployMode(picked) ? picked : initialValue; // ESC = 기본값
  const warning = deployModeWarning(mode);
  if (warning) io.note?.(warning, "배포 모드");
  return mode;
}

// 고른 플랫폼 중 배포 모드가 아직 없는 것만 묻는다.
async function askUnsetDeployModes(io, state) {
  const next = { ...state };
  for (const platform of state.stores ?? []) {
    const key = DEPLOY_MODE_KEY[platform];
    if (!next[key]) next[key] = await askDeployMode(io, platform, DEFAULT_DEPLOY_MODE);
  }
  return next;
}

// 아직 정해지지 않은 옵션만 묻는다.
//   envModeDefault  — 신규 설치 dart-define / 기존 설치 dotenv (동작 보존)
//   inferredStores  — 저장값 없는 기존 설치가 이미 쓰던 스토어 (신규 설치는 [])
export async function askUnsetFlutterOptions(io, state, { envModeDefault, inferredStores }) {
  const next = { ...state };
  if (!next.envMode) {
    const picked = await io.selectEnvMode({ initialValue: envModeDefault });
    next.envMode = isEnvMode(picked) ? picked : envModeDefault; // ESC = 기본값
  }
  if (next.stores === null) {
    const picked = await io.selectFlutterStores({ initialValues: inferredStores });
    next.stores = Array.isArray(picked) ? normalizeStores(picked) : inferredStores; // ESC = 초기 선택
  }
  return askUnsetDeployModes(io, next);
}

// 수정하기 메뉴에서 고른 항목 하나를 다시 묻는다. 현재값이 초기 선택이고 ESC는 현재값 유지.
export async function editFlutterOption(io, what, state, envModeDefault) {
  if (what === "envMode") {
    const picked = await io.selectEnvMode({ initialValue: state.envMode || envModeDefault });
    return isEnvMode(picked) ? { ...state, envMode: picked } : state;
  }
  if (what === "flutterStore") {
    const picked = await io.selectFlutterStores({ initialValues: state.stores ?? [] });
    if (!Array.isArray(picked)) return state;
    // 새로 추가된 플랫폼만 배포 모드를 묻는다 — 이미 정한 플랫폼의 모드는 그대로 둔다.
    return askUnsetDeployModes(io, { ...state, stores: normalizeStores(picked) });
  }
  if (what === "deployMode") {
    const stores = state.stores ?? [];
    if (!stores.length) {
      io.note?.("스토어 배포 대상을 먼저 선택하세요 ('스토어 배포 대상' 항목).", "배포 모드");
      return state;
    }
    const next = { ...state };
    for (const platform of stores) {
      const key = DEPLOY_MODE_KEY[platform];
      next[key] = await askDeployMode(io, platform, state[key] || DEFAULT_DEPLOY_MODE);
    }
    return next;
  }
  return state;
}
```

(3-c) `src/commands/interactive.js` 수정 — 위에서 아래 순서로 9곳.

① import: `import { isDeployStyle, DEFAULT_DEPLOY_STYLE } from "../core/deploy-style.js";` 다음 줄에 추가

```js
import { PATHS } from "../core/paths.js";
import { resolveFlutterOptions, DEFAULT_DEPLOY_MODE } from "../core/flutter-options.js";
import { inferInstalledStores } from "../core/installed-stores.js";
import { savedFlutterState, askUnsetFlutterOptions, editFlutterOption, FLUTTER_EDIT_ITEMS } from "./interactive-flutter.js";
```

② `const realTty = process.stdout.isTTY === true;` 바로 다음(그 줄 뒤)에 추가

```js

  // Flutter 옵션 (이슈 #131) — 저장값이 있으면 재질문하지 않는다 (deploy_style과 같은 규약).
  // 저장값 없는 기존 설치는 동작 보존을 위해 dotenv를 초기 선택으로, 스토어는 설치된 워크플로우로 추론한다.
  // 환경변수 기본값 규칙(신규=dart-define, 기존 설치·저장값 없음=dotenv)은 resolveFlutterOptions가 단일 진실이다.
  let flutter = savedFlutterState(existing);
  const flutterAsk = {
    envModeDefault: resolveFlutterOptions({
      cli: { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" }, existing,
    }).envMode,
    inferredStores: existing && flutter.stores === null ? inferInstalledStores(join(cwd, PATHS.workflowsDir)) : [],
  };
  // 이미 정해진 값은 건너뛰므로 여러 번 불러도 같은 질문이 반복되지 않는다.
  const askFlutterOptions = async () => {
    if (types.includes("flutter")) flutter = await askUnsetFlutterOptions(io, flutter, flutterAsk);
  };
```

③ 배포 방식 질문 블록 끝 — 기존

```js
      deployStyle = isDeployStyle(picked) ? picked : DEFAULT_DEPLOY_STYLE; // ESC = 기본값
    }

    // 신규 질문 — 자동 semver 승격 (기본 ON). 저장값 있으면 재질문 생략.
```
를 다음으로 교체:

```js
      deployStyle = isDeployStyle(picked) ? picked : DEFAULT_DEPLOY_STYLE; // ESC = 기본값
    }

    // Flutter 옵션 (이슈 #131) — 환경변수 방식 → 스토어 배포 대상 → 플랫폼별 배포 모드.
    await askFlutterOptions();

    // 신규 질문 — 자동 semver 승격 (기본 ON). 저장값 있으면 재질문 생략.
```

④ 수정 메뉴 호출: `const what = await io.editMenu({ showOptional });` →

```js
      const what = await io.editMenu({ showOptional, showFlutter: showOptional && types.includes("flutter") });
```

⑤ 수정 루프 분기 + 루프 종료 후 확정 — 기존

```js
        if (!isCancel(y)) includeSecretBackup = y === true;
      }
    }
  }

  const versionCode = existing?.versionCode
```
를 다음으로 교체(마지막 줄 `const versionCode = existing?.versionCode` 뒤는 원문 그대로 이어진다):

```js
        if (!isCancel(y)) includeSecretBackup = y === true;
      } else if (FLUTTER_EDIT_ITEMS.has(what)) {
        flutter = await editFlutterOption(io, what, flutter, flutterAsk.envModeDefault);
      }
    }
  }

  // 편집 루프에서 뒤늦게 flutter 타입이 추가된 경우에도 옵션을 확정한다 — 이미 정해진 값은 다시 묻지 않는다.
  if (showOptional) await askFlutterOptions();
  // 질문이 나오지 않은 경우(비 full 모드 등)도 동작 보존 기본값으로 채워 워크플로우 치환이 어긋나지 않게 한다.
  const flutterOptions = {
    envMode: flutter.envMode || flutterAsk.envModeDefault,
    stores: flutter.stores,
    androidDeployMode: flutter.androidDeployMode || DEFAULT_DEPLOY_MODE,
    iosDeployMode: flutter.iosDeployMode || DEFAULT_DEPLOY_MODE,
  };

  const versionCode = existing?.versionCode
```

⑥ `const resolvers = makeResolvers(cwd, repoName, paths);` →

```js
  const resolvers = makeResolvers(cwd, repoName, paths, flutterOptions);
```

⑦ `promptEnvPlan` 호출의 `resolvers, includeNexus, includeSecretBackup, deployStyle, targetRoot: cwd, repoName,` →

```js
      resolvers, includeNexus, includeSecretBackup, deployStyle, targetRoot: cwd, repoName,
      flutterStore: flutterOptions.stores, // 선택 해제된 스토어 워크플로우의 ask 질문은 묻지 않는다 (D2 env-plan)
```

⑧ `createContext({...})`의 `deployStyle: deployStyle || DEFAULT_DEPLOY_STYLE,` 다음 줄에 추가

```js
    envMode: flutterOptions.envMode, flutterStore: flutterOptions.stores,
    androidDeployMode: flutterOptions.androidDeployMode, iosDeployMode: flutterOptions.iosDeployMode,
```

⑨ `io.summary?.({…})`의 `cleanup: result?.cleanup ?? null,` 다음 줄에 추가

```js
    storeCleanup: result?.storeCleanup ?? null,
    flutterApp: result?.flutterApp ?? null,
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/installed-stores.test.js tests/node/interactive-flutter.test.js tests/node/interactive-branch-strategy.test.js tests/node/interactive-branch-picker.test.js tests/node/interactive-mode-summary.test.js tests/node/interactive-mode-status-doctor.test.js tests/node/interactive-mode-uninstall.test.js
```
예상: 전부 pass. 기존 interactive 테스트의 스텁 io에는 `selectEnvMode` 등이 없지만 모두 Flutter 타입이 아니거나(`types`에 flutter 없음) `mode`가 full이 아니라서 질문 경로에 들어가지 않는다(`askFlutterOptions`는 `types.includes("flutter")`가 아니면 즉시 반환, `interactive-mode-summary`의 pubspec 테스트는 mode `workflows`라 `showOptional`이 false).

---

### Task 12: `status` — Flutter 옵션 표시와 드리프트 오탐 방지

옵션 줄에 `env_mode`·`flutter_store`·`android_deploy_mode`·`ios_deploy_mode`를 Flutter 타입일 때만 표시한다. 또한 `runStatus`가 드리프트를 비교할 때 설치 때와 같은 Flutter 옵션(환경변수·배포 모드 치환, 스토어 선택 필터)을 쓰도록 맞춘다 — 그렇지 않으면 미수정 워크플로우가 "수정됨"으로, 선택 해제한 스토어 워크플로우가 "삭제함"으로 오탐된다. 이 Task는 커밋하지 않는다.

**Files:**
- Modify: `src/commands/status.js`
- Modify: `tests/node/status.test.js`

**Interfaces:**
- Consumes (D1): `resolveFlutterOptions({ cli, existing }) → { envMode, stores, androidDeployMode, iosDeployMode }`, `makeResolvers(root, repoName, paths, flutterOptions)`, `parseExisting().options.{envMode,flutterStore,androidDeployMode,iosDeployMode}`
- Consumes (D2): `planWorkflows(context, …)`가 `context.flutterStore`로 스토어 워크플로우를 필터
- Produces: `runStatus`의 `options`에 새 4개 키 포함(이미 `existing.options`를 그대로 전달하므로 D1 이후 자동), `printStatus` 옵션 줄에 Flutter 타입일 때 ` env_mode=… flutter_store=… android_deploy_mode=… ios_deploy_mode=…` 추가. 저장값이 없으면 `미설정(dotenv 유지)` / `미설정(둘 다 설치)` / `미설정(store_only)`로 실제 적용되는 기본 동작을 함께 표시

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/status.test.js` 수정

(1-a) 파일 상단 import 교체:

기존
```js
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
```
→
```js
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
```
그리고 `import { runStatus, printStatus } from "../../src/commands/status.js";` 다음 줄에 추가:
```js

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
```

(1-b) 파일 끝에 테스트 추가:

```js
function renderStatus(status) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try {
    printStatus(status);
  } finally {
    console.log = originalLog;
  }
  return output;
}

const FLUTTER_STATUS = {
  installed: true, version: "1.0.0", templateVersion: "0.10.1", types: ["flutter"], branches: null,
  options: {
    nexus: false, secretBackup: false, semverAuto: true,
    envMode: "dotenv", flutterStore: "android", androidDeployMode: "store_prepare", iosDeployMode: "store_only",
  },
  modifiedFiles: [],
};

test("printStatus: Flutter 타입이면 옵션 줄에 env_mode·flutter_store·배포 모드가 표시된다", () => {
  const output = renderStatus(FLUTTER_STATUS);
  assert.ok(output.includes("env_mode=dotenv"));
  assert.ok(output.includes("flutter_store=android"));
  assert.ok(output.includes("android_deploy_mode=store_prepare"));
  assert.ok(output.includes("ios_deploy_mode=store_only"));
});

test("printStatus: Flutter 저장값이 없으면 실제로 적용되는 기본 동작을 함께 알려준다", () => {
  const output = renderStatus({
    ...FLUTTER_STATUS,
    options: { nexus: false, secretBackup: false, semverAuto: true, envMode: null, flutterStore: null, androidDeployMode: null, iosDeployMode: null },
  });
  assert.ok(output.includes("env_mode=미설정(dotenv 유지)"));
  assert.ok(output.includes("flutter_store=미설정(둘 다 설치)"));
  assert.ok(output.includes("android_deploy_mode=미설정(store_only)"));
  assert.ok(output.includes("ios_deploy_mode=미설정(store_only)"));
  assert.ok(!output.includes("=null"));
});

test("printStatus: Flutter 타입이 아니면 Flutter 옵션은 표시하지 않는다", () => {
  const output = renderStatus({ ...FLUTTER_STATUS, types: ["spring"] });
  assert.ok(!output.includes("env_mode="));
  assert.ok(!output.includes("flutter_store="));
});

test("runStatus: 스토어 일부만 설치한 Flutter 프로젝트에서도 드리프트·삭제 오탐이 없다", () => {
  // 설치 때 env_mode·배포 모드가 워크플로우에 치환되고 iOS 스토어 워크플로우는 설치되지 않는다.
  // status가 같은 옵션으로 비교하지 않으면 PLAYSTORE가 '수정됨'으로 오탐된다.
  const target = mkdtempSync(join(tmpdir(), "paw-status-flutter-"));
  try {
    cpSync(join(REPO_ROOT, "tests/fixtures/flutter/pubspec.yaml"), join(target, "pubspec.yaml"));
    execFileSync(process.execPath, [
      join(REPO_ROOT, "bin/project-auto-wizard.js"),
      "--mode", "full", "--force", "--type", "flutter",
      "--main-branch", "main", "--develop-branch", "develop",
      "--flutter-env-mode", "dotenv", "--flutter-store", "android", "--android-deploy-mode", "store_prepare",
    ], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    const status = runStatus(resolvePayloadRoot(), target);
    assert.deepStrictEqual(status.modifiedFiles, []);
    assert.deepStrictEqual(status.buckets.removed, []);
    assert.strictEqual(status.options.envMode, "dotenv");
    assert.strictEqual(status.options.flutterStore, "android");
    assert.strictEqual(status.options.androidDeployMode, "store_prepare");
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/status.test.js
```
예상: `printStatus` 3건은 `output.includes("env_mode=dotenv")` 등이 false라 AssertionError. `runStatus` 통합 테스트는 `status.modifiedFiles`에 `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`이 포함되어(`ENV_MODE`/`DEPLOY_MODE` 치환 불일치) deepStrictEqual 실패.

- [ ] **Step 3: 최소 구현** — `src/commands/status.js`

(3-a) 상단 import에 추가 (`import { PATHS } from "../core/paths.js";` 다음 줄):
```js
import { resolveFlutterOptions } from "../core/flutter-options.js";
```

(3-b) `runStatus`의 기존
```js
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths);
```
를 교체:
```js
  // 설치 때 워크플로우에 치환된 환경변수 방식·배포 모드와 스토어 선택을 비교 기준에도 똑같이 적용한다 —
  // 그렇지 않으면 미수정 파일이 드리프트로, 선택 해제한 스토어 워크플로우가 "삭제함"으로 오탐된다.
  const flutterOptions = resolveFlutterOptions({
    cli: { envMode: "", stores: null, androidDeployMode: "", iosDeployMode: "" }, existing,
  });
  const resolvers = makeResolvers(targetRoot, repoName, existing.paths, flutterOptions);
```

(3-c) `context` 객체의 `repoName, resolvers, branches: branchesForCompare,` 줄을 교체:
```js
    repoName, resolvers, branches: branchesForCompare,
    flutterStore: flutterOptions.stores,
```

(3-d) `printStatus`의 옵션 줄 — 기존
```js
  lines.push(`옵션            : nexus=${boolLabel(status.options.nexus)} secret_backup=${boolLabel(status.options.secretBackup)} semver_auto=${semverAutoLabel}`);
```
를 교체:
```js
  const flutterLabels = status.types.includes("flutter") ? flutterOptionLabels(status.options) : "";
  lines.push(`옵션            : nexus=${boolLabel(status.options.nexus)} secret_backup=${boolLabel(status.options.secretBackup)} semver_auto=${semverAutoLabel}${flutterLabels}`);
```

(3-e) 파일 끝에 함수 추가:
```js

// Flutter 타입일 때만 붙는 옵션 (이슈 #131). 저장값이 없으면 그 상태에서 실제로 적용되는 동작을 함께 알린다.
function flutterOptionLabels(options) {
  return [
    ` env_mode=${options.envMode ?? "미설정(dotenv 유지)"}`,
    ` flutter_store=${options.flutterStore ?? "미설정(둘 다 설치)"}`,
    ` android_deploy_mode=${options.androidDeployMode ?? "미설정(store_only)"}`,
    ` ios_deploy_mode=${options.iosDeployMode ?? "미설정(store_only)"}`,
  ].join("");
}
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/status.test.js tests/node/interactive-mode-status-doctor.test.js
```
예상: 전부 pass.

---

### Task 13: `doctor` — Flutter 스토어 배포 필수 파일·ExportOptions 플레이스홀더 WARN

Flutter 프로젝트에서 선택한 플랫폼 기준으로 필수 파일 존재 여부와 `ios/ExportOptions.plist`의 미치환 플레이스홀더(`/__[A-Z][A-Z0-9_]*__/`)를 진단한다. 로컬 파일만 보는 점검이라 `gh` 조회 앞(설치 상태 행 바로 다음)에서 항상 수행한다. 스토어 시크릿 등록 검사는 범위 밖. 이 Task는 커밋하지 않는다.

**Files:**
- Modify: `src/commands/doctor.js`
- Modify: `tests/node/doctor.test.js`

**Interfaces:**
- Consumes (D1): `parseStoreList(csv)`, `storeAppFilesFor(stores) → string[]`(payload/flutter-app 기준 상대경로), `STORE_PLATFORMS`, `STORE_APP_FILES`; `parseExisting().options.flutterStore`, `.paths`
- Consumes (Task 11): `inferInstalledStores(workflowsDir)`
- Consumes (D6 계약): 플레이스홀더 `__TEAM_ID__`/`__BUNDLE_ID__`/`__PROVISIONING_PROFILE_NAME__`, 정규식 `/__[A-Z][A-Z0-9_]*__/`
- Produces: `runDoctor` 결과에 행 추가(`name`): `"Flutter Android 배포 파일"`, `"Flutter iOS 배포 파일"`(없는 파일이 있으면 `WARN`, 모두 있으면 `OK`), `"ExportOptions.plist"`(iOS 선택 + 파일 존재 시에만: 플레이스홀더 잔존 `WARN`, 없으면 `OK`); `DOC.flutterStore` (`…#flutter-store`, README 앵커는 Task 15)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/doctor.test.js`

(1-a) import 교체:

기존
```js
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
```
→
```js
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
```

(1-b) 파일 끝에 추가:

```js
// ── Flutter 스토어 배포 진단 (이슈 #131) ──────────────────────────────
const ANDROID_FASTFILE = "app/android/fastlane/Fastfile.playstore";
const IOS_FASTFILE = "app/ios/fastlane/Fastfile";
const EXPORT_OPTIONS = "app/ios/ExportOptions.plist";
const PLACEHOLDER_PLIST = "<plist><dict><string>__TEAM_ID__</string><string>__BUNDLE_ID__</string></dict></plist>\n";
const FILLED_PLIST = "<plist><dict><string>ABCDE12345</string><string>com.example.app</string></dict></plist>\n";
const NO_GH = fakeExec([["gh --version", { status: 1, stdout: "", stderr: "", error: new Error("not found") }]]);
const isFlutterRow = (r) => r.name.startsWith("Flutter ") || r.name === "ExportOptions.plist";

// storeLine이 ""면 flutter_store 저장값이 없는 (기능 이전) 설치를 흉내낸다.
function writeFlutterProject(dir, { storeLine = 'flutter_store: "android,ios"', files = {} } = {}) {
  const optionsLine = storeLine ? `      ${storeLine}\n` : "";
  writeFileSync(join(dir, "version.yml"),
    'version: "1.0.0"\nproject_types: ["flutter"]\nproject_paths:\n  flutter: "app"\n' +
    `metadata:\n  template:\n    options:\n      nexus: false\n${optionsLine}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
}

test("runDoctor: Flutter 스토어 배포 파일이 없으면 플랫폼별로 없는 파일을 WARN으로 알린다 (Flutter 루트 반영)", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir);
    const results = runDoctor(dir, { exec: NO_GH });
    const android = results.find((r) => r.name === "Flutter Android 배포 파일");
    const ios = results.find((r) => r.name === "Flutter iOS 배포 파일");
    assert.strictEqual(android.status, "WARN");
    assert.ok(android.value.includes(ANDROID_FASTFILE), "project_paths.flutter(app)가 경로에 반영되어야 한다");
    assert.strictEqual(ios.status, "WARN");
    assert.ok(ios.value.includes(IOS_FASTFILE) && ios.value.includes(EXPORT_OPTIONS));
    assert.ok(!results.some((r) => r.name === "ExportOptions.plist"), "plist가 없으면 플레이스홀더 점검 행은 없다");
    assert.ok(android.doc.endsWith("#flutter-store"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: ExportOptions.plist에 플레이스홀더가 남아 있으면 WARN, 값이 채워지면 OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    const files = { [ANDROID_FASTFILE]: "x", [IOS_FASTFILE]: "x", [EXPORT_OPTIONS]: PLACEHOLDER_PLIST };
    writeFlutterProject(dir, { files });
    let results = runDoctor(dir, { exec: NO_GH });
    assert.strictEqual(results.find((r) => r.name === "Flutter Android 배포 파일").status, "OK");
    assert.strictEqual(results.find((r) => r.name === "Flutter iOS 배포 파일").status, "OK");
    const plist = results.find((r) => r.name === "ExportOptions.plist");
    assert.strictEqual(plist.status, "WARN");
    assert.ok(plist.value.includes("__TEAM_ID__") && plist.value.includes("__BUNDLE_ID__"));
    const output = render(results);
    assert.ok(output.includes("ExportOptions.plist") && output.includes("__TEAM_ID__"));

    writeFileSync(join(dir, EXPORT_OPTIONS), FILLED_PLIST);
    results = runDoctor(dir, { exec: NO_GH });
    assert.strictEqual(results.find((r) => r.name === "ExportOptions.plist").status, "OK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: 선택한 플랫폼만 점검한다 (android만 선택하면 iOS·ExportOptions 행이 없다)", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, { storeLine: 'flutter_store: "android"', files: { [EXPORT_OPTIONS]: PLACEHOLDER_PLIST } });
    const names = runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow).map((r) => r.name);
    assert.deepStrictEqual(names, ["Flutter Android 배포 파일"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: flutter_store가 none이면 Flutter 행이 없다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, { storeLine: 'flutter_store: "none"' });
    assert.deepStrictEqual(runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: flutter_store 저장값이 없는 기존 설치는 설치된 스토어 워크플로우로 플랫폼을 추론한다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFlutterProject(dir, {
      storeLine: "",
      files: { ".github/workflows/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml": "" },
    });
    const names = runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow).map((r) => r.name);
    assert.deepStrictEqual(names, ["Flutter iOS 배포 파일"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDoctor: Flutter가 아닌 프로젝트는 저장된 스토어 옵션이 있어도 Flutter 행이 없다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-doctor-flutter-"));
  try {
    writeFileSync(join(dir, "version.yml"),
      'version: "1.0.0"\nproject_types: ["spring"]\nmetadata:\n  template:\n    options:\n      flutter_store: "ios"\n');
    assert.deepStrictEqual(runDoctor(dir, { exec: NO_GH }).filter(isFlutterRow), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/doctor.test.js
```
예상: 새 테스트 중 Flutter 행을 찾는 것들이 `TypeError: Cannot read properties of undefined (reading 'status')`, 배열 비교 테스트는 `[]`와 기대값 불일치로 실패. 기존 doctor 테스트는 그대로 pass.

- [ ] **Step 3: 최소 구현** — `src/commands/doctor.js`

(3-a) import 교체:

기존
```js
import { existsSync } from "node:fs";
import { join } from "node:path";
import { A, paint, colorEnabled, visualWidth } from "../ui/ansi.js";
```
→
```js
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { A, paint, colorEnabled, visualWidth } from "../ui/ansi.js";
import { PATHS } from "../core/paths.js";
import { parseExisting } from "../core/version-yml.js";
import { STORE_PLATFORMS, STORE_APP_FILES, parseStoreList, storeAppFilesFor } from "../core/flutter-options.js";
import { inferInstalledStores } from "../core/installed-stores.js";
```

(3-b) `DOC` 객체 교체:

기존
```js
export const DOC = {
  postInstall: `${REPO_URL}#post-install`,
};
```
→
```js
export const DOC = {
  postInstall: `${REPO_URL}#post-install`,
  flutterStore: `${REPO_URL}#flutter-store`,
};
```

(3-c) `runDoctor` 안 — 설치 여부 `add(installed ? … : …);` 문장 끝(`});` 다음)과 `const ghVersion = exec("gh", ["--version"]);` 사이에 추가:

```js

  // Flutter 스토어 배포 파일 점검 (이슈 #131) — 로컬 파일만 보므로 gh 조회 결과와 무관하게 수행한다.
  if (installed) for (const item of flutterStoreChecks(cwd)) add(item);
```

(3-d) `const asLines = …` 줄 바로 앞(`runDoctor` 함수 끝난 뒤)에 함수 추가:

```js
const PLATFORM_ROW_NAME = { android: "Flutter Android 배포 파일", ios: "Flutter iOS 배포 파일" };
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g; // 감지 규칙은 ExportOptions.plist 템플릿·IOS-TESTFLIGHT 검증과 동일
const EXPORT_OPTIONS_REL = STORE_APP_FILES.ios.find((rel) => rel.endsWith("ExportOptions.plist"));

// Flutter 스토어 배포 진단 — 선택한 플랫폼의 필수 파일과 ExportOptions.plist 플레이스홀더 (이슈 #131).
// 스토어 시크릿 등록 여부는 이번 범위 밖이다. 반환: doctor 결과 행 배열.
function flutterStoreChecks(cwd) {
  const existing = parseExisting(readFileSync(join(cwd, PATHS.versionFile), "utf8"));
  if (!existing.types.includes("flutter")) return [];
  const saved = existing.options.flutterStore == null ? null : parseStoreList(existing.options.flutterStore);
  // 저장값 없는 기존 설치는 설치된 스토어 워크플로우로 추론한다 (interactive와 같은 규칙).
  const stores = saved ?? inferInstalledStores(join(cwd, PATHS.workflowsDir));
  const flutterRoot = existing.paths.get("flutter") || ".";
  const rows = [];

  for (const platform of STORE_PLATFORMS.filter((p) => stores.includes(p))) {
    const files = storeAppFilesFor([platform]).map((rel) => posix.join(flutterRoot, rel));
    const missing = files.filter((file) => !existsSync(join(cwd, file)));
    const head = { name: PLATFORM_ROW_NAME[platform], purpose: "fastlane 스토어 업로드에 필요한 파일" };
    rows.push(missing.length
      ? {
        ...head, status: "WARN", value: `없는 파일: ${missing.join(", ")}`,
        impact: ["이 파일이 없으면 스토어 배포 워크플로우가 fastlane 단계에서 실패합니다."],
        actions: ["마법사를 다시 실행하면 없는 파일만 새로 만들어 줍니다 (이미 있는 파일은 덮어쓰지 않음)"],
        doc: DOC.flutterStore,
      }
      : { ...head, status: "OK", value: `${files.length}개 있음` });
  }

  const plistPath = posix.join(flutterRoot, EXPORT_OPTIONS_REL);
  if (stores.includes("ios") && existsSync(join(cwd, plistPath))) {
    const head = { name: "ExportOptions.plist", purpose: "iOS 서명·내보내기 설정" };
    const left = [...new Set(readFileSync(join(cwd, plistPath), "utf8").match(PLACEHOLDER_RE) ?? [])];
    rows.push(left.length
      ? {
        ...head, status: "WARN", value: `채워지지 않은 값: ${left.join(", ")}`,
        impact: ["채우지 않으면 IOS-TESTFLIGHT 워크플로우가 ExportOptions.plist 검증 단계에서 중단됩니다."],
        actions: [`${plistPath} 의 플레이스홀더를 실제 값(Team ID · 번들 ID · 프로비저닝 프로파일 이름)으로 바꾸세요`],
        doc: DOC.flutterStore,
      }
      : { ...head, status: "OK", value: "플레이스홀더 없음" });
  }
  return rows;
}
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/doctor.test.js
```
예상: 전부 pass (기존 `runDoctor: all checks OK` 등은 `version.yml`에 타입이 없어 새 행이 생기지 않는다).

---

### Task 14: `--dry-run`·설치 요약 — 스토어 배포 파일 생성/유지와 스토어 정리 결과 표시

`planDryRun`이 `planFlutterAppFiles` 결과를 포함하고 `printDryRun`이 신규/"기존 파일 유지"를 출력한다. `printSummary`는 생성·유지 파일과 스토어 선택 해제 정리 결과(삭제/`.bak`)를 보여준다. 이 Task는 커밋하지 않는다.

**Files:**
- Modify: `src/commands/dry-run.js`
- Modify: `src/ui/summary.js`
- Modify: `tests/node/dry-run.test.js`
- Modify: `tests/node/summary-output.test.js`

**Interfaces:**
- Consumes (D2): `planFlutterAppFiles(context, payloadRoot, targetRoot = ".") → { created: string[], kept: string[] }` (`src/core/copy/flutter-app.js`, 읽기 전용, 경로는 targetRoot 기준 POSIX 상대경로), `runFull` 반환 `storeCleanup { removed, backedUp }`, `flutterApp { created, kept }`(Task 11이 `io.summary`로 전달)
- Consumes (D1): `createContext` 필드 `flutterStore`, `makeResolvers(…, flutterOptions)`
- Produces: `planDryRun("full", …)`의 반환에 `flutterApp: { created, kept }` 추가; `printDryRun`이 `Flutter 스토어 배포 파일 — 신규 (N개)` / `기존 파일 유지 (N개, 덮어쓰지 않음)` 블록 출력(둘 다 비면 생략); `printSummary` 인자에 `flutterApp`, `storeCleanup` 추가 — `📱 Flutter 스토어 배포 파일:`(`새로 생성`/`기존 파일 유지`), `🧹 선택 해제한 스토어 배포 정리:`(삭제/`.bak` 백업)

- [ ] **Step 1: 실패하는 테스트 작성**

(1-a) `tests/node/dry-run.test.js` — import 교체:

기존
```js
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
```
→
```js
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
```
그리고 `import { runFull } from "../../src/commands/full.js";` 다음 줄에 추가:
```js
import { makeResolvers } from "../../src/core/detect-fs.js";
```

파일 끝에 추가:

```js
// ── Flutter 스토어 배포 파일 (이슈 #131) ──────────────────────────────
const FLUTTER_APP_TEMPLATES = ["android/fastlane/Fastfile.playstore", "ios/fastlane/Fastfile", "ios/ExportOptions.plist"];

// payload/flutter-app은 다른 작업에서 채워지므로, 임시 payload 사본에 최소 템플릿을 심어 독립적으로 검증한다.
function payloadWithFlutterApp() {
  const root = mkdtempSync(join(tmpdir(), "paw-dry-payload-"));
  cpSync(resolvePayloadRoot(), root, { recursive: true });
  for (const rel of FLUTTER_APP_TEMPLATES) {
    mkdirSync(dirname(join(root, "flutter-app", rel)), { recursive: true });
    writeFileSync(join(root, "flutter-app", rel), "stub\n");
  }
  return root;
}

function flutterContext(target, stores) {
  const paths = new Map([["flutter", "app"]]);
  const flutterOptions = { envMode: "dart-define", stores, androidDeployMode: "store_only", iosDeployMode: "store_only" };
  return baseContext({
    types: ["flutter"], paths, flutterStore: stores,
    envMode: flutterOptions.envMode, androidDeployMode: "store_only", iosDeployMode: "store_only",
    resolvers: makeResolvers(target, "sample", paths, flutterOptions),
  });
}

function captureLog(fn) {
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg; };
  try { fn(); } finally { console.log = originalLog; }
  return output;
}

test("planDryRun('full', ...) Flutter: 선택한 플랫폼의 스토어 배포 파일이 Flutter 루트(app) 기준 신규 목록에 들어가고 아무것도 쓰지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = payloadWithFlutterApp();
  try {
    const plan = planDryRun("full", flutterContext(target, ["android"]), payload, target);
    assert.deepStrictEqual(plan.flutterApp.created, ["app/android/fastlane/Fastfile.playstore"]);
    assert.deepStrictEqual(plan.flutterApp.kept, []);
    assert.deepStrictEqual(readdirSync(target), []);

    const both = planDryRun("full", flutterContext(target, ["android", "ios"]), payload, target);
    assert.deepStrictEqual(both.flutterApp.created, [
      "app/android/fastlane/Fastfile.playstore", "app/ios/fastlane/Fastfile", "app/ios/ExportOptions.plist",
    ]);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("printDryRun: 이미 있는 스토어 배포 파일은 '기존 파일 유지'로 표시하고 신규 목록과 구분한다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  const payload = payloadWithFlutterApp();
  try {
    mkdirSync(join(target, "app/android/fastlane"), { recursive: true });
    writeFileSync(join(target, "app/android/fastlane/Fastfile.playstore"), "# 내가 고친 Fastfile\n");
    const plan = planDryRun("full", flutterContext(target, ["android", "ios"]), payload, target);
    assert.deepStrictEqual(plan.flutterApp.kept, ["app/android/fastlane/Fastfile.playstore"]);
    assert.deepStrictEqual(plan.flutterApp.created, ["app/ios/fastlane/Fastfile", "app/ios/ExportOptions.plist"]);

    const output = captureLog(() => printDryRun(plan));
    assert.ok(output.includes("Flutter 스토어 배포 파일 — 신규 (2개)"));
    assert.ok(output.includes("+ app/ios/ExportOptions.plist"));
    assert.ok(output.includes("Flutter 스토어 배포 파일 — 기존 파일 유지 (1개"));
    assert.ok(output.includes("= app/android/fastlane/Fastfile.playstore (기존 파일 유지)"));
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(payload, { recursive: true, force: true });
  }
});

test("printDryRun: Flutter가 아니면 스토어 배포 파일 블록을 출력하지 않는다", () => {
  const target = mkdtempSync(join(tmpdir(), "paw-dry-"));
  try {
    const plan = planDryRun("full", baseContext(), resolvePayloadRoot(), target);
    assert.deepStrictEqual(plan.flutterApp, { created: [], kept: [] });
    assert.ok(!captureLog(() => printDryRun(plan)).includes("Flutter 스토어 배포 파일"));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
```

(1-b) `tests/node/summary-output.test.js` — 파일 끝에 추가:

```js
test("printSummary: Flutter 스토어 배포 파일을 '새로 생성'과 '기존 파일 유지'로 나눠 보여주고 ExportOptions 안내를 덧붙인다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      flutterApp: {
        created: ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"],
        kept: ["android/fastlane/Fastfile.playstore"],
      },
    });
  });
  assert.ok(output.includes("Flutter 스토어 배포 파일"));
  assert.ok(output.includes("ios/fastlane/Fastfile 새로 생성"));
  assert.ok(output.includes("android/fastlane/Fastfile.playstore 기존 파일 유지"));
  assert.ok(output.includes("__TEAM_ID__") && output.includes("__BUNDLE_ID__") && output.includes("__PROVISIONING_PROFILE_NAME__"));
});

test("printSummary: ExportOptions.plist를 새로 만들지 않았으면(이미 있음) 플레이스홀더 안내를 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({ mode: "full", types: ["flutter"], version: "1.0.0", flutterApp: { created: [], kept: ["ios/ExportOptions.plist"] } });
  });
  assert.ok(output.includes("ios/ExportOptions.plist 기존 파일 유지"));
  assert.ok(!output.includes("__TEAM_ID__"));
});

test("printSummary: 선택 해제한 스토어 배포 워크플로우의 정리 결과(삭제/.bak 백업)를 보여준다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      storeCleanup: {
        removed: ["PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"],
        backedUp: ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml"],
      },
    });
  });
  assert.ok(output.includes("선택 해제한 스토어 배포 정리"));
  assert.ok(output.includes("PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml 삭제 (손대지 않은 파일)"));
  assert.ok(output.includes("PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml → PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml.bak"));
});

test("printSummary: flutterApp·storeCleanup이 없거나 비어 있으면 해당 블록을 출력하지 않는다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["flutter"], version: "1.0.0",
      flutterApp: { created: [], kept: [] }, storeCleanup: { removed: [], backedUp: [] },
    });
  });
  assert.ok(!output.includes("Flutter 스토어 배포 파일"));
  assert.ok(!output.includes("스토어 배포 정리"));
});

test("printSummary: 배포 방식 변경 정리(cleanup) 출력은 그대로 유지된다", () => {
  const output = captureStderr(() => {
    printSummary({
      mode: "full", types: ["spring"], version: "1.0.0",
      cleanup: { removed: ["PROJECT-SPRING-SIMPLE-CICD.yaml"], backedUp: [] },
    });
  });
  assert.ok(output.includes("이전 배포 방식 정리"));
  assert.ok(output.includes("PROJECT-SPRING-SIMPLE-CICD.yaml 삭제 (손대지 않은 파일)"));
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/dry-run.test.js tests/node/summary-output.test.js
```
예상: dry-run 새 테스트는 `plan.flutterApp`이 `undefined`라 `TypeError: Cannot read properties of undefined (reading 'created')`. summary 새 테스트 4건은 `output.includes(...)` 실패(마지막 "cleanup 유지" 테스트는 현재도 pass — 리팩터링 회귀 가드).

- [ ] **Step 3: 최소 구현**

(3-a) `src/commands/dry-run.js`

import 추가 (`import { planWorkflows } from "../core/copy/workflows.js";` 다음 줄):
```js
import { planFlutterAppFiles } from "../core/copy/flutter-app.js";
```

`planDryRun`의 full 반환 교체:

기존
```js
  return {
    mode,
    workflows: planWorkflows(context, payloadRoot, targetRoot),
    versionYml: versionYmlPreview(context, payloadRoot, targetRoot),
  };
```
→
```js
  return {
    mode,
    workflows: planWorkflows(context, payloadRoot, targetRoot),
    // Flutter 스토어 배포 파일(Fastfile·ExportOptions.plist) — 이미 있는 파일은 덮어쓰지 않고 유지한다.
    flutterApp: planFlutterAppFiles(context, payloadRoot, targetRoot),
    versionYml: versionYmlPreview(context, payloadRoot, targetRoot),
  };
```

`printDryRun`의 `lines.push(`동일한 파일 (${w.unchanged.length}개, 변경 없음)`);` 다음의 `}` (`if (plan.workflows) {` 블록 끝) 뒤, `if (plan.versionYml) {` 앞에 추가:
```js
    if (plan.flutterApp && (plan.flutterApp.created.length || plan.flutterApp.kept.length)) {
      const { created, kept } = plan.flutterApp;
      lines.push(`Flutter 스토어 배포 파일 — 신규 (${created.length}개):`);
      for (const f of created) lines.push(`  + ${f}`);
      lines.push(`Flutter 스토어 배포 파일 — 기존 파일 유지 (${kept.length}개, 덮어쓰지 않음):`);
      for (const f of kept) lines.push(`  = ${f} (기존 파일 유지)`);
    }
```

(3-b) `src/ui/summary.js`

`printSummary`의 구조 분해 **11번째 줄 전체**(`    answers = [], unresolved = [], secrets = new Map(), logPath = "", legacyMdLogs = false, cleanup = null } = ctx || {};`)를 아래로 교체(부분 문자열 치환이 아니라 줄 전체 교체 — 앞부분을 그대로 남기면 `answers` 등의 바인딩이 중복 선언되어 `SyntaxError: Identifier 'answers' has already been declared`가 난다):
```js
    answers = [], unresolved = [], secrets = new Map(), logPath = "", legacyMdLogs = false, cleanup = null,
    // Flutter 스토어 배포 (이슈 #131) — 앱 파일 생성/유지와 스토어 선택 해제 정리 결과
    flutterApp = null, storeCleanup = null } = ctx || {};
```

기존 정리 블록
```js
  // 배포 방식을 바꿔 재설치한 경우, 이전 CD를 어떻게 처리했는지 알린다 (#80).
  if (cleanup?.removed?.length || cleanup?.backedUp?.length) {
    err("  🧹 이전 배포 방식 정리:");
    for (const f of cleanup.removed || []) err(`     • ${f} ${paint("삭제 (손대지 않은 파일)", A.dim, enabled)}`);
    for (const f of cleanup.backedUp || []) err(`     • ${f} → ${f}.bak ${paint("수정하신 내용이 있어 백업", A.dim, enabled)}`);
    err("");
  }
```
를 교체:
```js
  // 배포 방식을 바꿔 재설치한 경우, 이전 CD를 어떻게 처리했는지 알린다 (#80).
  printCleanup(err, enabled, "이전 배포 방식 정리", cleanup);
  // 스토어 배포 대상을 해제한 경우도 같은 규칙으로 정리한 결과를 알린다 (#131).
  printCleanup(err, enabled, "선택 해제한 스토어 배포 정리", storeCleanup);
  // Fastfile·ExportOptions.plist는 사용자 소유라 없을 때만 만든다 — 만든 것과 그대로 둔 것을 나눠 보여준다 (#131).
  const { created: appCreated = [], kept: appKept = [] } = flutterApp || {};
  if (appCreated.length || appKept.length) {
    err("  📱 Flutter 스토어 배포 파일:");
    for (const f of appCreated) err(`     • ${f} ${paint("새로 생성", A.dim, enabled)}`);
    for (const f of appKept) err(`     • ${f} ${paint("기존 파일 유지", A.dim, enabled)}`);
    if (appCreated.some((f) => f.endsWith("ExportOptions.plist"))) {
      err("     → ExportOptions.plist의 __TEAM_ID__ · __BUNDLE_ID__ · __PROVISIONING_PROFILE_NAME__ 을 실제 값으로 채워야 iOS 배포가 동작합니다");
    }
    err("");
  }
```

파일 끝(`printSummary` 함수 닫는 `}` 뒤)에 helper 추가:
```js

// 삭제·백업 정리 결과 한 블록 — 이전 배포 방식 정리와 스토어 선택 해제 정리가 같은 형식을 쓴다.
function printCleanup(err, enabled, title, cleanup) {
  if (!cleanup?.removed?.length && !cleanup?.backedUp?.length) return;
  err(`  🧹 ${title}:`);
  for (const f of cleanup.removed || []) err(`     • ${f} ${paint("삭제 (손대지 않은 파일)", A.dim, enabled)}`);
  for (const f of cleanup.backedUp || []) err(`     • ${f} → ${f}.bak ${paint("수정하신 내용이 있어 백업", A.dim, enabled)}`);
  err("");
}
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/dry-run.test.js tests/node/dry-run-cli.test.js tests/node/summary-output.test.js tests/node/summary-accuracy-cli.test.js tests/node/interactive-flutter.test.js
```
예상: 전부 pass (`planFlutterAppFiles`는 Flutter가 아니면 `{created:[],kept:[]}`를 돌려주므로 기존 dry-run 테스트는 그대로).

---

### Task 15: `breaking-changes.json` 고지 4건 + `collectBreaking` 배열 지원 + README Flutter 문서

- **왜 키가 `"0.10.1"`인가** — `src/core/breaking.js`의 `collectBreaking(json, current, target)`은 `compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0`인 항목만 모은다(`current < ver <= target`). 현재 배포본이 0.10.0이므로 키 `0.10.1`은 "0.10.0 이하에서 올라오는 모든 설치"에 대해 목표 버전(다음 릴리스)이 `0.10.1`이든 `0.11.0`이든 `1.0.0`이든 `0.10.1 <= target`이 성립해 표시된다. 반대로 이미 새 릴리스를 설치한 프로젝트(`current >= 0.10.1`)는 다시 보지 않는다. `_`로 시작하는 키는 메타로 무시된다.
- **왜 배열인가** — JSON 객체는 키가 유일해서 같은 버전 키에 항목 4건을 객체로 담을 수 없다(서로 다른 버전 키 4개로 쪼개면 릴리스 번호에 따라 일부가 안 보일 수 있다). 그래서 값으로 배열을 허용하도록 `collectBreaking`을 최소 확장한다. `src/core/breaking-check.js`는 `collectBreaking`이 돌려주는 레코드(`version`, `severity`, `title`, `message`)를 그대로 출력하므로 수정 불필요. 이 Task는 커밋하지 않는다.
- **참고** — 확장된 `collectBreaking`은 구버전 CLI가 원격(main)의 배열형 JSON을 읽으면 `title`/`message`가 빈 경고로 보일 수 있다(`loadBreakingJson`이 원격 우선). npx는 최신 CLI를 실행하므로 영향은 캐시된 구버전에 한정된다.

**Files:**
- Modify: `src/core/breaking.js`
- Modify: `payload/config/breaking-changes.json`
- Modify: `README.md`
- Modify: `tests/node/breaking-check.test.js`
- Create: `tests/node/readme-flutter-docs.test.js`

**Interfaces:**
- Consumes: `collectBreaking`(현 시그니처 유지), `runBreakingCheck({cwd, payloadRoot, templateVersion, askYesNo, loader})`, `breaking-check.js`의 stderr 박스 출력 형식(`[WARNING] <version> - <title>` / `→ <message>`)
- Produces:
  - `collectBreaking`: 값이 배열이면 각 요소를 별도 레코드로 펼침(`{ version: ver, ...entry }`), 객체면 기존과 동일
  - `payload/config/breaking-changes.json`: `"0.10.1"` 키 아래 `severity: "warning"` 4건(`title`, `message` 한 줄씩)
  - README: 앵커 `<a id="flutter-store"></a>`(doctor `DOC.flutterStore`가 가리킴)와 "Flutter 워크플로우 상세" 소절, 옵션 목록 4줄, status/doctor 설명 보강

- [ ] **Step 1: 실패하는 테스트 작성**

(1-a) `tests/node/breaking-check.test.js` — import 교체:

기존
```js
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBreakingCheck } from "../../src/core/breaking-check.js";
```
→
```js
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBreakingCheck } from "../../src/core/breaking-check.js";
import { collectBreaking } from "../../src/core/breaking.js";
```

파일 끝에 추가:

```js
// ── 이슈 #131 고지 4건 ───────────────────────────────────────────────
const BUNDLED = JSON.parse(readFileSync(new URL("../../payload/config/breaking-changes.json", import.meta.url), "utf8"));

test("collectBreaking: 같은 버전 키의 값이 배열이면 항목마다 별도 레코드로 펼친다", () => {
  const json = {
    "0.2.0": [
      { severity: "warning", title: "a", message: "m1" },
      { severity: "critical", title: "b", message: "m2" },
    ],
    "0.3.0": { severity: "warning", title: "c", message: "m3" },
    _meta: { severity: "critical", title: "무시" },
  };
  const { critical, warnings } = collectBreaking(json, "0.1.0", "0.3.0");
  assert.deepStrictEqual(critical.map((r) => r.title), ["b"]);
  assert.deepStrictEqual(warnings.map((r) => r.title), ["a", "c"]);
  assert.ok(critical.concat(warnings).every((r) => typeof r.version === "string"));
});

test("번들 breaking-changes.json: 0.10.0에서 0.10.1 이상으로 올라가면 warning 4건이 나온다 (다음 릴리스 번호와 무관)", () => {
  for (const target of ["0.10.1", "0.11.0", "1.0.0"]) {
    const { critical, warnings } = collectBreaking(BUNDLED, "0.10.0", target);
    assert.strictEqual(critical.length, 0, `${target}: critical 없음`);
    assert.strictEqual(warnings.length, 4, `${target}: warning 4건`);
    for (const w of warnings) {
      assert.strictEqual(w.severity, "warning");
      assert.ok(w.title && !w.title.includes("\n"), "제목은 한 줄");
      assert.ok(w.message && !w.message.includes("\n"), "박스에 그대로 찍히므로 메시지는 한 줄");
    }
  }
});

test("번들 breaking-changes.json: 4건은 SELFHOSTED·TEST-APK fastlane 제거 / dart-define 기본값 / FLUTTER_PROJECT_DIR / ci-gate를 각각 알린다", () => {
  const { warnings } = collectBreaking(BUNDLED, "0.10.0", "0.10.1");
  const text = warnings.map((w) => `${w.title} ${w.message}`);
  for (const keyword of ["fastlane build", "dart-define", "FLUTTER_PROJECT_DIR", "ci-gate"]) {
    assert.strictEqual(text.filter((t) => t.includes(keyword)).length >= 1, true, `${keyword} 고지가 있어야 한다`);
  }
  assert.ok(text.some((t) => t.includes("SELFHOSTED") && t.includes("TEST-APK")));
  assert.ok(text.some((t) => t.includes("dotenv")), "기존 설치는 dotenv 유지라는 안내");
  assert.ok(text.some((t) => t.includes("--paths flutter=")), "모노레포 경로 지정 안내");
});

test("번들 breaking-changes.json: 이미 0.10.1 이상이거나 아직 0.10.0까지만 올라가는 경우는 표시하지 않는다", () => {
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.10.1", "0.11.0"), { critical: [], warnings: [] });
  assert.deepStrictEqual(collectBreaking(BUNDLED, "0.9.0", "0.10.0"), { critical: [], warnings: [] });
});

test("runBreakingCheck: 번들 고지 4건은 모두 warning이라 대화형 확인 없이 진행하고 stderr 박스에 4건이 표시된다", async () => {
  const dir = makeRepo("0.10.0");
  const originalWrite = process.stderr.write.bind(process.stderr);
  let stderr = "";
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const proceed = await runBreakingCheck({
      cwd: dir, payloadRoot: "unused", templateVersion: "0.10.1",
      loader: async () => BUNDLED,
      askYesNo: async () => { throw new Error("warning만 있으면 확인 질문이 나오면 안 된다"); },
    });
    assert.strictEqual(proceed, true);
    assert.strictEqual((stderr.match(/\[WARNING\] 0\.10\.1 - /g) || []).length, 4);
    assert.ok(stderr.includes("BREAKING CHANGES (v0.10.0 → v0.10.1)"));
  } finally {
    process.stderr.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
  }
});
```

(1-b) `tests/node/readme-flutter-docs.test.js` 신규 — README 문서 항목 누락·doctor 링크 앵커 가드:

```js
// tests/node/readme-flutter-docs.test.js
// 이슈 #131 — README Flutter 문서에 빠지면 안 되는 항목과 doctor가 링크하는 앵커를 가드한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { DOC } from "../../src/commands/doctor.js";

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");

test("README: doctor가 링크하는 #flutter-store 앵커가 존재한다", () => {
  assert.ok(DOC.flutterStore.endsWith("#flutter-store"));
  assert.ok(README.includes('<a id="flutter-store"></a>'));
});

test("README: Flutter 문서에 채워야 할 항목·Secrets·환경변수·배포 모드·ci-gate·Gemfile 안내가 있다", () => {
  const required = [
    "ExportOptions.plist", "__TEAM_ID__", "__BUNDLE_ID__", "__PROVISIONING_PROFILE_NAME__",
    "ANDROID_PACKAGE_NAME", "ANDROID_DEPLOY_MODE", "IOS_DEPLOY_MODE", "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64",
    "APP_STORE_CONNECT_API_KEY_ID", "IOS_PROVISIONING_PROFILE_NAME",
    "--dart-define-from-file", "flutter_dotenv", "envied",
    "store_only", "store_prepare", "store_submit",
    "ci-gate", "Gemfile.lock",
    "--flutter-env-mode", "--flutter-store", "--android-deploy-mode", "--ios-deploy-mode",
    "기존 파일 유지",
  ];
  const missing = required.filter((token) => !README.includes(token));
  assert.deepStrictEqual(missing, [], `README에 빠진 항목: ${missing.join(", ")}`);
});

test("README: .env 파서 지원 범위(Flutter 3.47.5 기준)가 명시되어 있다", () => {
  for (const token of ["DotEnvRegex", "export KEY=값", '"""', "flutter_command.dart"]) {
    assert.ok(README.includes(token), `${token} 설명이 있어야 한다`);
  }
});
```

- [ ] **Step 2: 실행해 실패 확인**

```bash
node --test tests/node/breaking-check.test.js tests/node/readme-flutter-docs.test.js
```
예상: `breaking-check.test.js` 새 테스트는 배열 미지원/번들 `{}`라 `warnings.length` 0 → AssertionError(기존 6개 테스트는 pass). `readme-flutter-docs.test.js`는 `DOC.flutterStore` 미정의(Task 13 전이면 `TypeError`)이거나 앵커·항목 누락으로 실패.

- [ ] **Step 3: 최소 구현**

(3-a) `src/core/breaking.js` — `collectBreaking` 교체:

기존
```js
export function collectBreaking(json, current, target) {
  const critical = [], warnings = [];
  for (const [ver, entry] of Object.entries(json || {})) {
    if (ver.startsWith("_")) continue;
    if (compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0) {
      const rec = { version: ver, ...entry };
      (entry?.severity === "critical" ? critical : warnings).push(rec);
    }
  }
  return { critical, warnings };
}
```
→
```js
export function collectBreaking(json, current, target) {
  const critical = [], warnings = [];
  for (const [ver, value] of Object.entries(json || {})) {
    if (ver.startsWith("_")) continue;
    if (compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0) {
      // 한 릴리스에 고지가 여러 건이면 배열로 등록한다 — JSON 키(버전)는 유일해서 객체로는 한 건만 담긴다.
      for (const entry of Array.isArray(value) ? value : [value]) {
        const rec = { version: ver, ...entry };
        (entry?.severity === "critical" ? critical : warnings).push(rec);
      }
    }
  }
  return { critical, warnings };
}
```
그리고 함수 위 주석 3줄 아래에 한 줄 추가: `// 버전 키의 값은 항목 객체 또는 항목 객체의 배열(같은 릴리스에 고지가 여러 건일 때).`

(3-b) `payload/config/breaking-changes.json` 전체 교체:

```json
{
  "0.10.1": [
    {
      "severity": "warning",
      "title": "Flutter SELFHOSTED·TEST-APK가 flutter build를 직접 실행",
      "message": "SELFHOSTED·TEST-APK가 fastlane build 대신 flutter build apk --release를 직접 실행하고 Ruby·fastlane 설치 스텝이 사라집니다. fastlane은 스토어 배포 3종(PLAYSTORE·IOS-TESTFLIGHT·IOS-TEST-TESTFLIGHT)에서만 사용합니다."
    },
    {
      "severity": "warning",
      "title": "Flutter 환경변수 기본 방식이 dart-define으로 변경",
      "message": "신규 설치의 기본값이 dart-define(--dart-define-from-file)으로 바뀝니다. 기존 설치는 version.yml에 저장값이 없으면 dotenv(.env 생성)를 유지하며, 바꾸려면 마법사 '수정하기 > 환경변수 방식' 또는 --flutter-env-mode를 쓰세요."
    },
    {
      "severity": "warning",
      "title": "Flutter 워크플로우가 FLUTTER_PROJECT_DIR 기준으로 동작",
      "message": "FIREBASE·SELFHOSTED·CI·TEST-APK·IOS-TEST-TESTFLIGHT도 PLAYSTORE처럼 Flutter 루트(FLUTTER_PROJECT_DIR)에서 동작합니다. Flutter가 하위 폴더에 있는 모노레포는 --paths flutter=<경로>로 지정하세요."
    },
    {
      "severity": "warning",
      "title": "모노레포 CI required check는 ci-gate 하나만 등록",
      "message": "CI 워크플로우(Flutter·Go·Next·Python·React·Spring NEXUS-CI)는 항상 실행되고 변경이 없으면 job을 건너뜁니다. required check로 쓰려면 개별 job이 아닌 CI Gate(ci-gate) 하나만 등록하세요."
    }
  ]
}
```

(3-c) `README.md` 수정 — 5곳.

**① Flutter 요약 bullet 교체** — 기존
```
- **flutter**: Android(Firebase/Playstore/Selfhosted/TestAPK 배포), iOS(TestFlight/Test-TestFlight), CI, Lab 트리거까지 8종
```
→
```
- **flutter**: Android(Firebase/Playstore/Selfhosted/TestAPK 배포), iOS(TestFlight/Test-TestFlight), CI, Lab 트리거까지 8종 — 스토어 배포(Play Store·TestFlight)는 고른 플랫폼만 설치되고 fastlane 파일도 함께 생성됩니다. 환경변수 방식·배포 모드 등 자세한 내용은 아래 "Flutter 워크플로우 상세"를 참고하세요.
```

**② 새 소절 삽입** — `- **go**: CI(Dockerfile 불필요, go test/vet/build/lint) / PR 프리뷰 / SimpleCICD(Dockerfile 있는 프로젝트만 해당)` 줄과 `### 실행 로그 (` 헤딩 사이(빈 줄 유지)에 아래 본문 전체를 삽입한다. (아래 블록 안의 표·인라인 코드는 README에 그대로 들어가는 마크다운이다.)

````markdown
<a id="flutter-store"></a>

#### Flutter 워크플로우 상세

프로젝트 타입에 `flutter`가 포함되면 마법사가 아래 선택지 3개를 묻습니다. 고른 값은 `version.yml`의 `metadata.template.options`(`env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`)에 기록되므로 다시 실행해도 묻지 않고, 나중에 바꾸려면 확인 화면의 **수정하기 > 환경변수 방식 / 스토어 배포 대상 / 배포 모드**를 쓰세요. Flutter가 없는 프로젝트에는 이 질문·저장값이 전혀 나타나지 않습니다.

| 선택지 | 값 | 기본값 | CLI 플래그 |
|---|---|---|---|
| 환경변수 방식 | `dart-define` / `dotenv` | 신규 설치는 `dart-define`. `version.yml`이 이미 있고 저장값이 없는 설치는 기존 동작을 보존하려고 `dotenv` 유지 | `--flutter-env-mode` |
| 스토어 배포 대상 | Android(Play Store) / iOS(TestFlight) 다중 선택 | 대화형 신규 설치는 아무것도 선택하지 않은 상태, 비대화형·플래그 미지정은 현행 동작(둘 다 설치). 저장값이 없는 기존 설치는 이미 설치된 스토어 워크플로우에서 초기 선택을 추론 | `--flutter-store android,ios,none` |
| 배포 모드 | 고른 플랫폼별 `store_only` / `store_prepare` / `store_submit` | `store_only` | `--android-deploy-mode`, `--ios-deploy-mode` |

**설치되는 구성**

- 항상 설치: `CI`, `ANDROID-FIREBASE-CICD`, `ANDROID-SELFHOSTED-CICD`, `ANDROID-TEST-APK`, `APP-BUILD-TRIGGER`
- Android를 고르면: `ANDROID-PLAYSTORE-CICD` + `android/fastlane/Fastfile.playstore`
- iOS를 고르면: `IOS-TESTFLIGHT` + `IOS-TEST-TESTFLIGHT` + `ios/fastlane/Fastfile` + `ios/ExportOptions.plist`
- fastlane은 위 스토어 배포 워크플로우에서만 씁니다. `SELFHOSTED`와 `TEST-APK`는 `flutter build apk --release`를 직접 실행하며 Ruby·fastlane을 설치하지 않습니다.
- `Fastfile`과 `ExportOptions.plist`는 **Flutter 루트 기준**으로(모노레포는 `--paths flutter=app`이면 `app/` 아래) **없을 때만 생성**합니다. 이미 있으면 덮어쓰지 않고 설치 요약과 `--dry-run`에 "기존 파일 유지"로 표시하며, `--mode uninstall`도 이 파일들은 건드리지 않습니다(사용자 소유 파일).
- 스토어 대상을 해제하고 다시 실행하면 배포 방식을 바꿀 때와 같은 규칙으로 정리합니다 — 손대지 않은 워크플로우는 삭제하고, 수정한 것은 `.bak`으로 옮겨 보존합니다. `Fastfile`·`ExportOptions.plist`는 삭제하지 않습니다.

**환경변수 방식**

두 방식 모두 시크릿 `ENV_FILE`(없으면 `ENV`)에 `.env` 형식으로 값을 넣어 두면 됩니다. 두 방식을 동시에 쓰는 모드는 없습니다.

- `dart-define`: `ENV_FILE`을 프로젝트 밖 임시 경로(러너 임시 폴더)에 쓰고 모든 `flutter build`에 `--dart-define-from-file`로 넘깁니다. 프로젝트 루트에는 `.env`를 만들지 않으며, 코드에서는 `String.fromEnvironment('KEY')`로 읽습니다. 값이 아닌 파일 경로를 넘기므로 `--verbose` 로그에도 값이 명령줄에 노출되지 않습니다.
- `dotenv`: Flutter 루트에 `.env`를 만든 뒤 빌드합니다(`build_runner`가 그 뒤에 실행되는 순서 유지). `flutter_dotenv`·`envied`를 쓰는 프로젝트가 여기에 해당합니다. 이 `.env`에는 아래 파서 제약이 적용되지 않습니다.

`dart-define` 방식에서 `ENV_FILE`은 Flutter의 `--dart-define-from-file` 파서가 읽으므로 다음 범위만 지원됩니다 (근거: Flutter 3.47.5 `flutter_tools/lib/src/runner/flutter_command.dart`의 `DotEnvRegex`).

- 내용이 `{`로 시작하면 JSON 파일로 해석하고, 그렇지 않으면 `KEY=값` 줄로 해석합니다. 키는 `[a-zA-Z_][a-zA-Z0-9_]*` 형태여야 합니다.
- `#`로 시작하는 주석 줄과 빈 줄은 무시합니다.
- 값은 `"…"`, `'…'`, `` `…` `` 따옴표가 벗겨지고 그 뒤의 `# 주석`은 제거됩니다. 따옴표 없는 값은 공백 또는 `#` 앞까지 읽으며, 값 안의 `=`는 허용됩니다.
- `export KEY=값` 형태와 멀티라인(`"""`) 값은 지원하지 않아 빌드가 오류로 종료됩니다.

**배포 모드** — 플랫폼별로 아래처럼 동작합니다(모르는 값은 `store_only`로 취급). 기본값은 워크플로우 표현식의 폴백 자리에 반영되며, 저장소 변수 `ANDROID_DEPLOY_MODE`·`IOS_DEPLOY_MODE`와 `workflow_dispatch` 입력이 항상 우선합니다.

| 모드 | Play Store (Android) | TestFlight / App Store (iOS) |
|---|---|---|
| `store_only` | internal 트랙에 업로드 | TestFlight 업로드 |
| `store_prepare` | production 트랙에 draft 상태로 업로드 (Play Console에서 직접 출시) | 앱 버전·메타데이터 준비까지 (심사 제출 안 함) |
| `store_submit` | production 트랙에 심사 제출 | 심사 제출까지 |

> `store_submit`을 고르면 **main push마다 심사가 자동 제출**됩니다.

**필요한 Secrets · Variables** — 설치 완료 화면과 실행 로그에도 설치된 워크플로우가 실제로 요구하는 Secret 목록이 출력됩니다.

| 대상 | Secrets | Variables |
|---|---|---|
| 모든 Flutter 빌드 | `ENV_FILE` (없으면 `ENV`) | — |
| Android 서명 (`PLAYSTORE`·`FIREBASE`·`TEST-APK`) | `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON` | — |
| Play Store (`PLAYSTORE`) | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `ANDROID_PACKAGE_NAME` | `ANDROID_PACKAGE_NAME`(Secret이 없을 때 대신 사용), `ANDROID_DEPLOY_MODE`(선택) |
| iOS (`IOS-TESTFLIGHT`·`IOS-TEST-TESTFLIGHT`) | `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, `IOS_PROVISIONING_PROFILE_NAME`, `IOS_BUNDLE_ID`, `SECRETS_XCCONFIG`(선택) | `IOS_BUNDLE_ID`(Secret이 없을 때 대신 사용), `IOS_DEPLOY_MODE`(선택) |
| Firebase 배포 (`FIREBASE`·`TEST-APK`) | `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | — |
| Selfhosted 배포 (`SELFHOSTED`) | `SERVER_HOST`, `SERVER_USER`, `SERVER_PASSWORD`, `DEBUG_KEYSTORE` | — |

`ANDROID_PACKAGE_NAME`은 `PLAYSTORE` 워크플로우가 fastlane에 패키지명으로 넘깁니다(`secrets` 우선, 없으면 `vars`). iOS의 `IOS_BUNDLE_ID`와 같은 플랫폼 접두사 규칙입니다.

**`ExportOptions.plist`에 채워야 할 값** — 마법사가 만든 `ios/ExportOptions.plist`에는 아래 플레이스홀더가 들어 있어 실제 값으로 바꿔야 합니다. 채우지 않고 `IOS-TESTFLIGHT`를 실행하면 `xcodebuild`의 알기 어려운 오류 대신 플레이스홀더가 남았다는 메시지로 검증 단계에서 중단되며, `--mode doctor`도 같은 항목을 WARN으로 알려줍니다.

| 플레이스홀더 | 채울 값 |
|---|---|
| `__TEAM_ID__` | Apple Developer Team ID |
| `__BUNDLE_ID__` | 앱 번들 ID (`IOS_BUNDLE_ID`와 같은 값) |
| `__PROVISIONING_PROFILE_NAME__` | 프로비저닝 프로파일 이름 (`IOS_PROVISIONING_PROFILE_NAME`과 같은 값) |

**모노레포와 `ci-gate`**

- `--paths flutter=app`처럼 Flutter 하위 폴더를 지정하면 모든 Flutter 워크플로우가 그 폴더(`FLUTTER_PROJECT_DIR`)를 기준으로 동작하고, main push로 도는 배포 워크플로우(`PLAYSTORE`·`IOS-TESTFLIGHT`·`SELFHOSTED`·`FIREBASE`)는 `app/**`가 바뀔 때만 실행됩니다(Spring 등 다른 타입과 같은 `paths` 필터).
- CI 워크플로우(Flutter·Go·Next·Python·React·Spring NEXUS-CI)는 `push`·`pull_request`에서 항상 실행되고, 첫 job `changes`가 변경 파일을 판별해 나머지 job을 건너뜁니다(건너뛴 job은 Success). 마지막 job `ci-gate`는 항상 실행되어 필수 job이 모두 success 또는 skipped이면 통과하고 failure·cancelled가 하나라도 있으면 실패합니다.
- 브랜치 보호 규칙의 required status check에는 개별 job이 아니라 **`CI Gate`(`ci-gate`) 하나만** 등록하세요. 경로 필터로 워크플로우 자체를 건너뛰면 required check가 Pending에 머물러 머지가 막히지만, job을 건너뛰는 방식은 그렇지 않기 때문입니다.
- 워크플로우 `paths` 필터는 태그 push에 적용되지 않습니다(GitHub 문서).

**Gemfile** — 스토어 배포 워크플로우(`PLAYSTORE`·`IOS-TESTFLIGHT`·`IOS-TEST-TESTFLIGHT`)는 사용자 `Gemfile`에 `fastlane`이 있으면 그것을 쓰고, 없으면 실행할 때 생성합니다. 마법사는 Gemfile 템플릿을 배포하지 않습니다. fastlane 공식 문서가 권장하는 대로 `Gemfile`(`gem "fastlane"`)과 `Gemfile.lock`을 저장소에 커밋해 두면 버전이 고정되어 재현성이 좋아집니다.
````

**③ 설치 옵션 목록에 4줄 추가** — 기존
```
      --deploy-style S     서버 배포 방식: simple | nginx | traefik | none (기본: simple)
```
바로 다음 줄에 삽입:
```
      --flutter-env-mode M     Flutter 환경변수 방식: dart-define | dotenv (신규 기본: dart-define, 저장값 없는 기존 설치는 dotenv 유지)
      --flutter-store CSV      Flutter 스토어 배포 대상: android,ios,none (미지정 시 둘 다 설치)
      --android-deploy-mode M  Play Store 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
      --ios-deploy-mode M      iOS 배포 모드: store_only | store_prepare | store_submit (기본: store_only)
```

**④ status 설명 보강** — `| \`--mode status\` | 설치된 버전·타입·브랜치 모드·옵션값과, ` 로 시작하는 행에서 `옵션값과,`를 `옵션값(Flutter 프로젝트면 환경변수 방식·스토어 배포 대상·배포 모드 포함)과,`로 교체.

**⑤ doctor 설명 보강** — 같은 표의 doctor 행에서 `merge commit 허용 설정을 점검합니다.`를 다음으로 교체:
```
merge commit 허용 설정을 점검합니다. Flutter 프로젝트에서는 고른 스토어 플랫폼의 필수 파일(`Fastfile`, `ExportOptions.plist` 등)과 `ExportOptions.plist`의 플레이스홀더 잔존 여부도 점검합니다(로컬 파일만 확인, 스토어 시크릿 등록 여부는 점검하지 않음).
```

- [ ] **Step 4: 통과 확인**

```bash
node --test tests/node/breaking-check.test.js tests/node/readme-flutter-docs.test.js tests/node/legacy-naming-guard.test.js
```
예상: 전부 pass (`legacy-naming-guard`는 `payload`·`src`를 스캔하므로 JSON·소스에 종속 이름이 없는지 함께 확인). 이어서 D3 전체 회귀:

```bash
node --test tests/node/prompts-flutter.test.js tests/node/prompts-branch-strategy.test.js tests/node/installed-stores.test.js tests/node/interactive-flutter.test.js tests/node/status.test.js tests/node/doctor.test.js tests/node/dry-run.test.js tests/node/summary-output.test.js tests/node/breaking-check.test.js tests/node/readme-flutter-docs.test.js
```
예상: 전부 pass.

### Task 16: Go·Next·Python·React CI에 `changes` + `ci-gate` 적용과 구조·치환·actionlint 테스트 신설

**Files:**
- Create: `tests/node/ci-gate-payload.test.js`
- Modify: `payload/workflows/go/PROJECT-GO-CI.yaml`
- Modify: `payload/workflows/next/PROJECT-NEXT-CI.yaml`
- Modify: `payload/workflows/python/PROJECT-PYTHON-CI.yaml`
- Modify: `payload/workflows/react/PROJECT-REACT-CI.yaml`

**Interfaces:**
- 소비(D1이 이미 병합했어야 함, 계약 §4): `src/core/detect-fs.js`의 `makeResolvers(root, repoName, paths)`가 돌려주는 `"project-path": (t) => paths.get(t) || "."` 리졸버. 이 Task가 YAML에 넣는 `# @wizard auto:project-path` 마커가 이 리졸버로 치환된다. 이 리졸버가 없으면 신설 테스트의 치환 검증과 e2e 설치 테스트가 실패한다(전제 확인 Step 1).
- 소비(기존): `makeSrcText(branches)`(`src/core/copy/workflows.js`), `substituteEnv(content, opts)`(`src/core/wizard-env.js`) — 시그니처 변경 없음. 설치 시 실제 인자와 같은 `{ type, repoName, projectPath: paths.get(type) || ".", resolvers }`를 테스트가 재현한다.
- 생산: 각 CI 워크플로우에 job id `changes`(출력 `project`), `ci-gate`(항상 실행, `needs: [changes, <기존 모든 job>]`), 최상위 env `PROJECT_PATH`. 기존 job은 `needs: changes` + `if: ${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}`를 가진다. 사용자는 `ci-gate`만 required check로 등록하면 된다.
- 생산: `tests/node/ci-gate-payload.test.js`의 `CI_TARGETS` 배열(`{ file, type, jobs }`), `renderInstalled`, `topLevelBlock`, `parseJobs`, `actionlintNewFindings` 헬퍼 — Task 17이 같은 파일에 이어서 쓴다.

**읽고 확인한 현재 상태 (이 Task 시점의 원본):**

| 파일 | 기존 job id | 기존 job의 `needs`/`if` | 최상위 `env:` | 최상위 `permissions` | 트리거 |
|---|---|---|---|---|---|
| `go/PROJECT-GO-CI.yaml` | `build-check` (`name: Go 빌드 검증`) | 둘 다 없음 | 있음 (`PROJECT_NAME`) | 없음 | push(develop), pull_request(develop), workflow_dispatch |
| `python/PROJECT-PYTHON-CI.yaml` | `build-check` (`name: Python FastAPI 빌드 검증`) | 둘 다 없음 | 있음 (`PROJECT_NAME`) | 없음 | push(develop), pull_request(develop), workflow_dispatch |
| `next/PROJECT-NEXT-CI.yaml` | `build` (`name: Next.js 애플리케이션 빌드`) | 둘 다 없음 (스텝에만 `if`) | 있음 (`PROJECT_NAME`, `NODE_VERSION`, `ENV_FILE`) | `contents: read`, `pull-requests: write`, `issues: write` | push(develop), workflow_dispatch (**pull_request 트리거 없음**) |
| `react/PROJECT-REACT-CI.yaml` | `build` (`name: React/Next.js 애플리케이션 빌드`) | 둘 다 없음 (스텝에만 `if`) | 있음 (`PROJECT_NAME`, `NODE_VERSION`, `ENV_FILE`) | 위와 동일 | push(develop), workflow_dispatch (**pull_request 트리거 없음**) |

- 4개 모두 최상위 `env:`가 이미 있으므로 계약대로 그 블록에 `PROJECT_PATH`를 **추가**한다(중복 `env:` 금지). 기존 job에 `if`가 없으므로 `&&` 결합은 필요 없다.
- Next·React에는 워크플로우 최상위 `permissions`가 있다. `changes` job은 자체 `permissions`(`contents: read`, `pull-requests: read`)로 좁혀서 선언하고, `ci-gate`는 계약대로 `permissions`를 두지 않아 최상위 값을 상속한다(토큰을 쓰지 않는 job이라 영향 없음).
- Next·React는 기존부터 `pull_request` 트리거가 없다. 이 Task는 트리거를 바꾸지 않는다(이슈 범위 밖). 그래서 이 두 파일의 `ci-gate`는 develop push와 수동 실행에서만 돈다. 필요하면 후속으로 다룬다(최종 보고에 명시됨).
- `workflow_dispatch`: `changes` job은 돌지만 판별 결과와 무관하게 기존 job은 항상 실행된다(`if`의 첫 항). `dorny/paths-filter`가 `workflow_dispatch`에서 정상 동작하는지는 로컬에서 재현할 수 없어 PR 이후 테스트 레포 확인 항목이다.

**actionlint 검증 방침 (조사 결과):**
- 원본 파일에는 `{{MAIN_BRANCH}}`/`{{DEVELOP_BRANCH}}` 플레이스홀더와 `@wizard` 마커가 있지만, 전부 문자열·주석 안에 있어서 **원본을 그대로 돌려도 actionlint는 구문 오류 없이 돈다**(2026-09-21, actionlint 1.7.12 + shellcheck 설치 환경에서 실측). 그래도 사용자가 실제로 받는 형태를 검사하려고 테스트는 `makeSrcText` + `substituteEnv`로 치환한 **임시 사본**에 실행한다(원본은 수정하지 않음).
- 기존부터 있던 지적(전부 `shellcheck` 종류, 구문·표현식·액션 입력 오류는 0건): Go 0, Python 0, Next `SC2086`(info) 4, React `SC2086` 4, Spring CI `SC2086` 31 + `SC2129` 4, Spring publish 2종 각각 `SC2086` 1 + `SC2193`(warning) 1.
- **신규 경고만 실패로 취급하는 기준**: ① `kind`가 `shellcheck`가 아닌 지적(needs 오타·표현식 오류·알 수 없는 액션 입력·권한 오류 등)은 위치와 무관하게 전부 실패. ② `shellcheck` 지적은 이 이슈가 새로 넣은 job(`changes`, `ci-gate`) 안에서 생긴 것만 실패(지적의 줄 번호가 어느 job 범위에 드는지로 판정). 기존 job의 shellcheck 지적은 이 이슈 범위 밖이라 허용한다. 개수가 아니라 위치로 가르므로 shellcheck 버전이 달라져 기존 지적 수가 변해도 흔들리지 않는다.
- `actionlint`가 PATH에 없으면 해당 테스트만 skip한다(구조·치환 테스트는 항상 실행). 레포 의존성으로 추가하지 않는다.

**삽입할 YAML 블록 (Task 16의 4개 파일 공통):**

블록 A — 최상위 `env:`에 추가하는 2줄:

```yaml
  # 모노레포에서 이 프로젝트가 있는 하위 경로 ('.'이면 항상 검증)
  PROJECT_PATH: "."  # @wizard auto:project-path
```

블록 B — `changes` job (배너 주석 포함):

```yaml
  # ===================================================================
  # 변경 감지 (모노레포에서 이 프로젝트 경로가 바뀌었는지 판별)
  # ===================================================================
  changes:
    name: 변경 감지
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      project: ${{ steps.filter.outputs.project }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: 프로젝트 경로 변경 여부 판별
        id: filter
        if: ${{ github.event_name != 'workflow_dispatch' }}
        uses: dorny/paths-filter@v4
        with:
          filters: |
            project:
              - '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'
```

블록 C — 기존 job에 추가하는 2줄 (`runs-on:` 바로 다음):

```yaml
    needs: changes
    if: ${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}
```

블록 D — 파일 끝에 붙이는 `ci-gate` job. `needs`의 `<기존 job id>`만 파일마다 다르다(Go `build-check`, Python `build-check`, Next `build`, React `build`):

```yaml
  # ===================================================================
  # CI Gate (required check로 등록할 단일 job)
  # ===================================================================
  ci-gate:
    name: CI Gate
    if: ${{ always() }}
    needs: [changes, <기존 job id>]
    runs-on: ubuntu-latest
    steps:
      - name: 결과 집계
        env:
          RESULTS: ${{ toJSON(needs.*.result) }}
        run: |
          echo "needs 결과: $RESULTS"
          if echo "$RESULTS" | grep -Eq '"(failure|cancelled)"'; then
            echo "실패하거나 취소된 job이 있습니다."
            exit 1
          fi
```

파일별 앵커(각각 파일 안에서 정확히 1회만 나오는 것을 확인함):

| 파일 | 블록 A 앵커 (이 줄 바로 다음 줄에 삽입) | 블록 B 앵커 (이 줄 바로 다음 줄에 삽입) | 블록 C 앵커 (이 두 줄 바로 다음에 삽입) | 블록 D 의 `<기존 job id>` |
|---|---|---|---|---|
| Go | `  PROJECT_NAME: "__PROJECT_NAME__"  # @wizard ask:@repo` | `jobs:` (줄 전체) | `    name: Go 빌드 검증` + `    runs-on: ubuntu-latest` | `build-check` |
| Python | `  PROJECT_NAME: "__PROJECT_NAME__"  # @wizard ask:@repo` | `jobs:` | `    name: Python FastAPI 빌드 검증` + `    runs-on: ubuntu-latest` | `build-check` |
| Next | `  ENV_FILE: ".env"` | `jobs:` | `    name: Next.js 애플리케이션 빌드` + `    runs-on: ubuntu-latest` | `build` |
| React | `  ENV_FILE: ".env"` | `jobs:` | `    name: React/Next.js 애플리케이션 빌드` + `    runs-on: ubuntu-latest` | `build` |

- 블록 B는 삽입 후 뒤에 **빈 줄 1개**를 두어 기존 job(또는 기존 배너 주석)과 분리한다. 블록 D는 파일 끝(원본은 개행 1개로 끝남)에 **빈 줄 1개를 먼저** 넣고 붙인다. 삽입 후 파일은 개행 1개로 끝나야 한다.
- 마커 줄 `PROJECT_PATH: "."  # @wizard auto:project-path`의 값은 반드시 겹따옴표다(`tests/node/payload-example-values.test.js`가 마커 줄의 겹따옴표를 강제하는 것과 같은 관례이며, `setEnvLine`이 겹따옴표로 통일해 치환한다).
- 블록 A의 첫 줄(설명 주석)에는 `@wizard`가 없어야 한다(주석 줄이 마커로 오인되지 않게).
- 블록 B의 필터 줄 `- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'`는 `filters: |` **블록 스칼라 안의 문자열**이라 안쪽 홑따옴표가 YAML 문법 오류가 아니다. 러너가 표현식을 평가한 뒤 `dorny/paths-filter`에는 `- '**'`(단일 레포) 또는 `- 'services/api/**'`(모노레포)가 전달된다. 이 줄을 "고쳐" 쓰지 말고 그대로 둔다.

- [ ] **Step 1: 전제 확인**

```bash
git branch --show-current                      # 20260921_#131_... 여야 한다
grep -n '"project-path"' src/core/detect-fs.js  # D1이 넣은 리졸버 1줄이 나와야 한다. 없으면 여기서 멈추고 보고한다.
command -v actionlint && actionlint --version   # 없어도 진행 가능(해당 테스트만 skip)
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/node/ci-gate-payload.test.js`를 아래 내용으로 새로 만든다 (Spring 항목과 publish 테스트는 Task 17에서 이어 붙인다).

```js
// tests/node/ci-gate-payload.test.js
// 이슈 #131 (A) — CI 워크플로우는 항상 실행하되 첫 job `changes`가 이 프로젝트 경로의 변경 여부를 판별하고,
// 나머지 job은 그 결과로 건너뛴다(건너뛴 job은 Success). 항상 실행되는 `ci-gate` 하나만 required check로
// 등록하면 되도록 job 결과를 집계한다. 이 파일은 그 골격이 payload에서 깨지지 않게 고정한다.
//
// YAML 파서 의존성을 추가하지 않는다 — payload-yaml.test.js처럼 들여쓰기 기반 줄 단위 검사를 쓰고,
// 문법·표현식·액션 입력 오류는 actionlint(PATH에 있을 때만)에 맡긴다.
import { test, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeSrcText } from "../../src/core/copy/workflows.js";
import { substituteEnv } from "../../src/core/wizard-env.js";
import { makeResolvers } from "../../src/core/detect-fs.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS_DIR = join(REPO_ROOT, "payload", "workflows");
const BRANCHES = { main: "main", develop: "develop" };
const MONOREPO_PATH = "services/api";

// jobs: 기존 job id 전부 — ci-gate가 needs로 걸어야 하는 대상이다. job이 늘면 여기도 늘려야 통과한다.
const CI_TARGETS = [
  { file: "go/PROJECT-GO-CI.yaml", type: "go", jobs: ["build-check"] },
  { file: "next/PROJECT-NEXT-CI.yaml", type: "next", jobs: ["build"] },
  { file: "python/PROJECT-PYTHON-CI.yaml", type: "python", jobs: ["build-check"] },
  { file: "react/PROJECT-REACT-CI.yaml", type: "react", jobs: ["build"] },
];

const EXPECTED_JOB_IF =
  "${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}";
const EXPECTED_FILTER_LINE =
  "- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'";
const PROJECT_PATH_MARKER_LINE = '  PROJECT_PATH: "."  # @wizard auto:project-path';

// jdk 리졸버가 읽을 빈 디렉토리 — 이 레포의 build.gradle 유무에 결과가 흔들리지 않게 한다.
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "paw-ci-gate-root-"));
after(() => rmSync(EMPTY_ROOT, { recursive: true, force: true }));

// 설치 시 실제로 일어나는 치환을 그대로 재현한다 (copy/workflows.js의 makeSrcText + envOptsFor와 같은 인자).
function renderInstalled(file, type, paths = new Map()) {
  const src = makeSrcText(BRANCHES)(join(WORKFLOWS_DIR, file));
  return substituteEnv(src, {
    type,
    repoName: "demo-repo",
    projectPath: paths.get(type) || ".",
    resolvers: makeResolvers(EMPTY_ROOT, "demo-repo", paths),
  });
}

const rawText = (file) => readFileSync(join(WORKFLOWS_DIR, file), "utf8");

// ── 줄 단위 구조 헬퍼 ──────────────────────────────────────────────────────────

// 들여쓰기 0의 `key:` 다음 줄부터 다음 최상위 키 전까지 (주석·빈 줄 포함).
function topLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(start >= 0, `최상위 '${key}:'가 없습니다`);
  const end = lines.findIndex((l, i) => i > start && /^[A-Za-z_]/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

// jobs 블록 → Map<jobId, 그 job의 줄들>. job id는 들여쓰기 2칸의 `id:` 줄이다.
function parseJobs(text) {
  const jobs = new Map();
  let current = null;
  for (const line of topLevelBlock(text, "jobs")) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) {
      current = [];
      jobs.set(header[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

// job 직속 키(들여쓰기 4칸) 값. 스텝은 `- ` 로 시작하고 더 깊게 들여쓰므로 섞이지 않는다.
function jobField(jobLines, key) {
  const prefix = `    ${key}:`;
  const line = jobLines.find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

// `[a, b, c]` → ["a","b","c"]
const parseFlowList = (value) => value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);

// ── 구조 검증 ─────────────────────────────────────────────────────────────────

for (const { file, type, jobs } of CI_TARGETS) {
  const text = rawText(file);

  test(`${file}: job 구성은 changes + 기존 job + ci-gate 뿐이다`, () => {
    assert.deepStrictEqual([...parseJobs(text).keys()].sort(), ["changes", ...jobs, "ci-gate"].sort());
  });

  test(`${file}: 기존 job은 changes에 의존하고 변경 없음이면 건너뛴다 (workflow_dispatch는 항상 실행)`, () => {
    const parsed = parseJobs(text);
    for (const id of jobs) {
      assert.strictEqual(jobField(parsed.get(id), "needs"), "changes", `${id}: needs`);
      assert.strictEqual(jobField(parsed.get(id), "if"), EXPECTED_JOB_IF, `${id}: if`);
    }
  });

  test(`${file}: changes job은 dorny/paths-filter로 PROJECT_PATH 하위 변경만 판별한다`, () => {
    const changes = parseJobs(text).get("changes");
    const body = changes.join("\n");
    assert.match(body, /uses: dorny\/paths-filter@v4/);
    assert.match(body, /^ {8}if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}$/m, "workflow_dispatch에서는 판별 스텝을 건너뛴다");
    assert.match(body, /^ {6}contents: read$/m);
    assert.match(body, /^ {6}pull-requests: read$/m);
    assert.match(body, /^ {6}project: \$\{\{ steps\.filter\.outputs\.project \}\}$/m);
    assert.ok(changes.some((l) => l.trim() === EXPECTED_FILTER_LINE), "필터 표현식이 계약과 다릅니다");
  });

  test(`${file}: ci-gate는 항상 실행되고 모든 job을 needs로 집계한다`, () => {
    const gate = parseJobs(text).get("ci-gate");
    assert.strictEqual(jobField(gate, "if"), "${{ always() }}");
    assert.deepStrictEqual(parseFlowList(jobField(gate, "needs")).sort(), ["changes", ...jobs].sort());
    const body = gate.join("\n");
    assert.match(body, /RESULTS: \$\{\{ toJSON\(needs\.\*\.result\) \}\}/);
    assert.match(body, /grep -Eq '"\(failure\|cancelled\)"'/);
    assert.match(body, /^ {12}exit 1$/m);
  });

  test(`${file}: PROJECT_PATH는 단일 최상위 env 블록에 auto:project-path 마커로 선언된다`, () => {
    assert.strictEqual((text.match(/^env:/gm) || []).length, 1, "최상위 env:가 하나여야 합니다");
    assert.ok(topLevelBlock(text, "env").includes(PROJECT_PATH_MARKER_LINE), "PROJECT_PATH 마커 줄이 env 블록에 없습니다");
  });

  test(`${file}: --paths가 있으면 PROJECT_PATH가 그 경로로, 없으면 '.'로 치환되고 마커가 사라진다`, () => {
    const monorepo = renderInstalled(file, type, new Map([[type, MONOREPO_PATH]]));
    assert.ok(topLevelBlock(monorepo, "env").includes(`  PROJECT_PATH: "${MONOREPO_PATH}"`));
    assert.ok(!monorepo.includes("auto:project-path"));
    assert.ok(monorepo.includes("env.PROJECT_PATH"), "changes 필터의 env 참조는 그대로여야 합니다");

    const single = renderInstalled(file, type);
    assert.ok(topLevelBlock(single, "env").includes('  PROJECT_PATH: "."'));
    assert.ok(!single.includes("auto:project-path"));
  });
}

// ── actionlint ────────────────────────────────────────────────────────────────
// 원본에는 `{{MAIN_BRANCH}}` 플레이스홀더와 `@wizard` 마커가 있어 그대로 검사하기 부적절하므로,
// 설치 때와 같은 치환(renderInstalled)을 거친 임시 사본을 검사한다.
//
// 기준선(2026-09-21, actionlint 1.7.12): 원본 CI·publish 워크플로우에는 구문·표현식·액션 입력 오류가 0건이고
// shellcheck 지적(SC2086 info, SC2129 style, SC2193 warning)만 기존부터 있다(Next 4, React 4, Spring CI 35,
// Spring publish 2종 각 2). 그 지적은 이 이슈 범위 밖이라 허용하고, 새로 생긴 것만 실패로 본다:
//   ① shellcheck 이외 종류의 지적은 위치와 관계없이 전부 실패 (needs 오타, 표현식 오류, 알 수 없는 액션 입력 등)
//   ② shellcheck 지적은 이 이슈가 새로 넣은 job(changes, ci-gate) 안에서만 실패
// shellcheck 버전에 따라 기존 지적 수가 달라져도 흔들리지 않도록 개수가 아니라 위치로 가른다.
const ACTIONLINT_AVAILABLE = spawnSync("actionlint", ["-version"], { encoding: "utf8" }).status === 0;
const SKIP_ACTIONLINT = ACTIONLINT_AVAILABLE ? false : "actionlint가 PATH에 없어 건너뜁니다";

// 렌더된 텍스트에서 job id → 시작 줄(1부터). finding의 줄이 어느 job에 속하는지 가르는 데 쓴다.
function jobStartLines(text) {
  const starts = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) starts.push({ id: header[1], line: i + 1 });
  });
  return starts;
}

function jobOfLine(starts, line) {
  return starts.filter((s) => s.line <= line).at(-1)?.id ?? null;
}

// 렌더된 워크플로우를 actionlint로 검사해 "새로 생긴 것으로 간주할 지적" 목록을 돌려준다.
function actionlintNewFindings(renderedText, fileName, newJobIds) {
  const dir = mkdtempSync(join(tmpdir(), "paw-actionlint-"));
  try {
    const target = join(dir, fileName);
    writeFileSync(target, renderedText);
    const result = spawnSync("actionlint", ["-no-color", "-format", "{{json .}}", target], { encoding: "utf8" });
    // 0=지적 없음, 1=지적 있음, 그 외는 실행 자체가 실패한 것
    assert.ok(result.status === 0 || result.status === 1, `actionlint 실행 실패: ${result.stderr}`);
    const findings = JSON.parse(result.stdout.trim() || "[]") ?? [];
    const starts = jobStartLines(renderedText);
    return findings
      .filter((f) => f.kind !== "shellcheck" || newJobIds.includes(jobOfLine(starts, f.line)))
      .map((f) => `${fileName}:${f.line}:${f.column} [${f.kind}] ${f.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { file, type } of CI_TARGETS) {
  const fileName = file.split("/").pop();
  for (const [label, paths] of [["단일 레포", new Map()], ["모노레포", new Map([[type, MONOREPO_PATH]])]]) {
    test(`${file}: 치환된 사본이 actionlint를 통과한다 (${label}, 신규 지적 0건)`, { skip: SKIP_ACTIONLINT }, () => {
      const findings = actionlintNewFindings(renderInstalled(file, type, paths), fileName, ["changes", "ci-gate"]);
      assert.deepStrictEqual(findings, [], `actionlint 신규 지적:\n  ${findings.join("\n  ")}`);
    });
  }
}

test("actionlint 헬퍼는 존재하지 않는 job을 needs로 걸면 지적을 잡아낸다 (헬퍼가 공회전하지 않는다는 증거)", { skip: SKIP_ACTIONLINT }, () => {
  const { file, type } = CI_TARGETS[0];
  const broken = renderInstalled(file, type).replace("needs: [changes, build-check]", "needs: [changes, no-such-job]");
  assert.notStrictEqual(broken, renderInstalled(file, type), "치환 대상 줄을 찾지 못했습니다");
  assert.ok(actionlintNewFindings(broken, "broken.yaml", ["changes", "ci-gate"]).length > 0);
});
```

- [ ] **Step 3: 실패 확인 (RED)**

```bash
node --test tests/node/ci-gate-payload.test.js
```

기대 결과: `go/python/next/react` 각각의 구조·치환 테스트 24개(파일당 6개)와 `broken.yaml` 헬퍼 검증 테스트 1개, 합쳐 25개가 실패한다. 헬퍼 검증 테스트는 `needs: [changes, build-check]` 문자열을 원본에서 찾아 깨뜨리는 방식인데, 원본에는 아직 그 줄이 없어 `assert.notStrictEqual(broken, renderInstalled(...))`(치환 대상을 못 찾음) 단계에서부터 실패한다 — RED에서 정상이다. actionlint를 원본(치환 사본) 그대로 돌리는 테스트 8개는 기준선과 같아 이미 통과한다. 만약 이 8개 중 하나라도 실패하면 기준선 조사가 틀린 것이므로 실패 메시지의 지적 목록을 이 Task의 "기존부터 있던 지적" 목록과 대조해 보고한다.

- [ ] **Step 4: Go 수정** (`payload/workflows/go/PROJECT-GO-CI.yaml`)

위 표의 Go 행 앵커에 블록 A, B, C를 삽입하고, 파일 끝에 블록 D(`needs: [changes, build-check]`)를 붙인다. 결과로 `env:`는 `PROJECT_NAME`, `PROJECT_PATH` 두 항목이 되고 `jobs:` 아래는 `changes` → `build-check` → `ci-gate` 순서가 된다.

- [ ] **Step 5: Python 수정** (`payload/workflows/python/PROJECT-PYTHON-CI.yaml`)

위 표의 Python 행 앵커에 블록 A, B, C를 삽입하고, 파일 끝에 블록 D(`needs: [changes, build-check]`)를 붙인다.

- [ ] **Step 6: Next 수정** (`payload/workflows/next/PROJECT-NEXT-CI.yaml`)

위 표의 Next 행 앵커에 블록 A, B, C를 삽입하고, 파일 끝에 블록 D(`needs: [changes, build]`)를 붙인다. 결과로 `env:`는 `PROJECT_NAME`, `NODE_VERSION`, `ENV_FILE`, `PROJECT_PATH` 순서가 된다. 최상위 `permissions:`는 그대로 둔다.

- [ ] **Step 7: React 수정** (`payload/workflows/react/PROJECT-REACT-CI.yaml`)

위 표의 React 행 앵커에 블록 A, B, C를 삽입하고, 파일 끝에 블록 D(`needs: [changes, build]`)를 붙인다. 최상위 `permissions:`는 그대로 둔다.

- [ ] **Step 8: 통과 확인 (GREEN) + 회귀 확인**

```bash
node --test tests/node/ci-gate-payload.test.js
node --test tests/node/payload-yaml.test.js tests/node/workflow-action-versions.test.js tests/node/payload-example-values.test.js tests/node/line-endings.test.js tests/node/e2e-matrix.test.js tests/node/install-matrix.test.js
git diff --stat -- payload/workflows/go payload/workflows/next payload/workflows/python payload/workflows/react
```

기대 결과: 첫 번째 명령은 33개 통과(actionlint가 없으면 9개 skip), 두 번째도 전부 통과. `git diff --stat`는 4개 파일에 각각 추가 줄만 있고 삭제 줄은 0이어야 한다. 설치본을 눈으로도 확인한다.

```bash
# 치환된 사본을 직접 만들어 actionlint에 넣어 본다 (모노레포 경로 예: services/api)
T=$(mktemp -d)
node --input-type=module -e '
import { makeSrcText } from "./src/core/copy/workflows.js";
import { substituteEnv } from "./src/core/wizard-env.js";
import { makeResolvers } from "./src/core/detect-fs.js";
const [file, type, projectPath] = process.argv.slice(1);
const src = makeSrcText({ main: "main", develop: "develop" })(`payload/workflows/${file}`);
process.stdout.write(substituteEnv(src, { type, repoName: "demo", projectPath, resolvers: makeResolvers("/nonexistent", "demo", new Map([[type, projectPath]])) }));
' go/PROJECT-GO-CI.yaml go services/api > "$T/PROJECT-GO-CI.yaml"
grep -n 'PROJECT_PATH' "$T/PROJECT-GO-CI.yaml"   # PROJECT_PATH: "services/api" 와 필터 표현식 줄만 나온다
actionlint "$T/PROJECT-GO-CI.yaml"                # 출력 없음 (Go는 shellcheck 지적도 0건)
rm -rf "$T"
```

---

### Task 17: Spring NEXUS-CI에 `changes` + `ci-gate` 적용, publish 2종에 `paths` 앵커 추가

**Files:**
- Modify: `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`
- Modify: `payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml`
- Modify: `payload/workflows/spring/nexus/PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml`
- Modify: `tests/node/ci-gate-payload.test.js` (Task 16에서 생성됨 — 여기서는 항목 추가만)

**Interfaces:**
- 소비: Task 16이 만든 `tests/node/ci-gate-payload.test.js`의 `CI_TARGETS`, `renderInstalled`, `topLevelBlock`, `rawText`, `actionlintNewFindings`, `SKIP_ACTIONLINT`, `MONOREPO_PATH`. D1의 `"project-path"` 리졸버(계약 §4).
- 소비(기존, 변경 없음): `substituteEnv`의 paths-anchor 치환 — `PATHS_ANCHOR_RE = /#\s*@wizard\s+paths-anchor/`에 맞는 줄을 통째로 `${앵커 줄의 들여쓰기}paths: ['${projectPath}/**']`로 바꾼다(`projectPath`가 `.`이 아닐 때만).
- 생산: NEXUS-CI에 `changes`/`ci-gate`/`PROJECT_PATH`(Task 16과 같은 골격). publish 2종의 `on.push`에 `    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)` 한 줄.

**읽고 확인한 현재 상태:**
- `PROJECT-SPRING-NEXUS-CI.yml`: job id `build-check`(`name: Build Verification`), 기존 job 수준 `needs`/`if` 없음. 최상위 `env:` 있음(`JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:@jdk`), 최상위 `permissions`(`contents: read`, `pull-requests: write`, `issues: write`, `checks: write`), 트리거 pull_request(develop; opened/synchronize/reopened)+push(develop)+workflow_dispatch. 스텝 수준 `if`가 여럿(`Generate Build Report`/`Extract Error Details`/`Create Check Run`은 `always()`, PR 댓글 2개는 `github.event_name == 'pull_request' && ...`, `Fail Job on Build Failure`).
  - 리포트 성격 스텝(`if: always()`, PR 댓글, Check Run 생성)은 **job 수준 `if`가 false이면 job 전체가 건너뛰어져 함께 실행되지 않는다**. 그래서 스텝 조건을 바꾸거나 `needs.changes...`를 결합할 필요가 없다(변경 없는 PR에 댓글·체크 런이 남지 않음). job은 건너뛰면 Success로 보고되고, `ci-gate`는 skipped를 통과로 본다.
- `PROJECT-SPRING-NEXUS-PUBLISH.yml`: `on.push`가 `branches: ["{{MAIN_BRANCH}}"]`(인라인 리스트, 들여쓰기 4칸) + `tags:`(들여쓰기 4칸) + `      - 'v*.*.*'`(들여쓰기 6칸). `workflow_dispatch` 없음. 그 뒤 빈 줄과 최상위 `concurrency:`.
- `PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml`: `on.push`가 위와 같은 `branches`+`tags` 구조이고 그 뒤에 `  workflow_dispatch:`(들여쓰기 2칸)가 온다.

**앵커 위치 결정 (publish 2종):** `tags:` 목록의 마지막 줄 `      - 'v*.*.*'` **바로 다음 줄**에 들여쓰기 4칸 주석으로 둔다(기존 Spring/Next/React/Go/Python CICD가 push 블록 맨 끝에 4칸 주석 앵커를 두는 관례와 같다). `substituteEnv`가 이 줄을 `    paths: ['<경로>/**']`로 바꾸면 `branches`·`tags`·`paths`가 모두 들여쓰기 4칸의 형제 키가 되어 유효한 YAML이다. `tags:` 목록(들여쓰기 6칸) 안에 들어가지 않는 것은 테스트가 치환 결과로 확인한다(`tags:` 바로 뒤 줄이 `- 'v*.*.*'`이고 그 다음 줄이 `paths:`).

**태그 push가 막히지 않는다는 근거:** GitHub 공식 문서(Workflow syntax → `on.push.<branches|tags|branches-ignore|tags-ignore>` / 경로 필터 설명)에 "Path filters are not evaluated for pushes of tags"라고 명시되어 있다. 즉 `paths`를 함께 선언해도 `v*.*.*` 태그 push는 경로 필터 평가 대상이 아니라 `tags` 패턴만 맞으면 워크플로우가 실행된다. main 브랜치 push에는 `branches`와 `paths` 조건이 모두 만족되어야 실행되므로 모노레포에서 해당 경로가 안 바뀐 push는 건너뛴다(의도). 이 이슈가 "구현 전에 실제로 한 번 검증"하라고 한 항목이다 — 로컬에서 실제 GitHub Actions 태그 push를 재현할 수 없으므로 (a) 위 문서 근거, (b) 치환 결과 구조를 파싱하는 테스트와 actionlint 통과, (c) PR 이후 테스트 레포에서의 실제 태그 push 확인(이슈 검증 항목으로 남김)으로 갈음한다.

**삽입할 YAML 블록 (Task 16과 같은 골격, 이 Task가 독립 실행되므로 전문을 다시 적음):**

블록 A — 최상위 `env:` 추가 2줄:

```yaml
  # 모노레포에서 이 프로젝트가 있는 하위 경로 ('.'이면 항상 검증)
  PROJECT_PATH: "."  # @wizard auto:project-path
```

블록 B — `changes` job:

```yaml
  # ===================================================================
  # 변경 감지 (모노레포에서 이 프로젝트 경로가 바뀌었는지 판별)
  # ===================================================================
  changes:
    name: 변경 감지
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      project: ${{ steps.filter.outputs.project }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: 프로젝트 경로 변경 여부 판별
        id: filter
        if: ${{ github.event_name != 'workflow_dispatch' }}
        uses: dorny/paths-filter@v4
        with:
          filters: |
            project:
              - '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'
```

블록 C — 기존 job `build-check`에 추가하는 2줄:

```yaml
    needs: changes
    if: ${{ github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true' }}
```

블록 D — 파일 끝에 붙이는 `ci-gate` (`needs: [changes, build-check]`):

```yaml
  # ===================================================================
  # CI Gate (required check로 등록할 단일 job)
  # ===================================================================
  ci-gate:
    name: CI Gate
    if: ${{ always() }}
    needs: [changes, build-check]
    runs-on: ubuntu-latest
    steps:
      - name: 결과 집계
        env:
          RESULTS: ${{ toJSON(needs.*.result) }}
        run: |
          echo "needs 결과: $RESULTS"
          if echo "$RESULTS" | grep -Eq '"(failure|cancelled)"'; then
            echo "실패하거나 취소된 job이 있습니다."
            exit 1
          fi
```

블록 E — publish 2종에 삽입하는 앵커 1줄 (들여쓰기 4칸):

```yaml
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
```

앵커 표 (각각 파일 안에서 정확히 1회만 나오는 것을 확인함):

| 파일 | 삽입 블록 | 앵커 (이 줄/줄들 바로 다음에 삽입) |
|---|---|---|
| `PROJECT-SPRING-NEXUS-CI.yml` | 블록 A | `  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:@jdk` |
| `PROJECT-SPRING-NEXUS-CI.yml` | 블록 B (뒤에 빈 줄 1개) | `jobs:` |
| `PROJECT-SPRING-NEXUS-CI.yml` | 블록 C | `    name: Build Verification` + `    runs-on: ubuntu-latest` (원본에서 그 다음 줄은 공백 4칸만 있는 줄이며 그대로 둔다) |
| `PROJECT-SPRING-NEXUS-CI.yml` | 블록 D | 파일 끝(빈 줄 1개 먼저, 개행 1개로 끝나야 함) |
| `PROJECT-SPRING-NEXUS-PUBLISH.yml` | 블록 E | `      - 'v*.*.*'` |
| `PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml` | 블록 E | `      - 'v*.*.*'` |

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/ci-gate-payload.test.js`에서 `CI_TARGETS`의 마지막 항목을 찾아 Spring 항목을 추가한다.

교체 전:

```js
  { file: "react/PROJECT-REACT-CI.yaml", type: "react", jobs: ["build"] },
];
```

교체 후:

```js
  { file: "react/PROJECT-REACT-CI.yaml", type: "react", jobs: ["build"] },
  { file: "spring/nexus/PROJECT-SPRING-NEXUS-CI.yml", type: "spring", jobs: ["build-check"] },
];
```

그리고 파일 맨 끝(마지막 `});` 다음, 빈 줄 하나를 두고)에 아래 블록을 이어 붙인다.

```js
// ── Spring publish 2종: on.push의 paths 앵커 ──────────────────────────────────
// main push 배포 워크플로우는 job 단위 필터 없이 기존 `# @wizard paths-anchor` 방식을 쓴다. 이 두 파일은
// push 블록에 branches와 tags(`v*.*.*`)가 함께 있어서, 앵커가 tags 목록에 삼켜지지 않는 위치·들여쓰기인지가 관건이다.
//
// 태그 push는 필터의 영향을 받지 않는다 — GitHub 문서(workflow syntax, `on.push.<branches|tags>`)에
// "Path filters are not evaluated for pushes of tags"라고 명시돼 있다. 그래서 `paths`를 넣어도 `v*.*.*` 태그 배포는
// 그대로 돈다. 아래 테스트는 치환 결과의 구조(keys 순서, tags 목록 무손상)를 고정하고, 실제 태그 push 동작은
// 로컬에서 재현할 수 없어 PR 이후 테스트 레포에서 확인한다(이슈 검증 항목).
const PUBLISH_TARGETS = [
  "spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml",
  "spring/nexus/PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml",
];
const PATHS_ANCHOR_LINE = "    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)";

// on.push 블록(들여쓰기 4칸 이상 줄들). 다음 이벤트(`  workflow_dispatch:` 등)나 최상위 키에서 끝난다.
function pushBlock(text) {
  const onLines = topLevelBlock(text, "on");
  const start = onLines.findIndex((l) => /^ {2}push:\s*$/.test(l));
  assert.ok(start >= 0, "on.push 블록이 없습니다");
  const block = [];
  for (const line of onLines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break;
    block.push(line);
  }
  while (block.length > 0 && block.at(-1).trim() === "") block.pop();
  return block;
}

const pushKeys = (block) => block.filter((l) => /^ {4}[a-z-]+:/.test(l)).map((l) => l.trim().split(":")[0]);

for (const file of PUBLISH_TARGETS) {
  test(`${file}: on.push 블록 안에 paths 앵커가 한 번, branches·tags와 같은 들여쓰기로 있다`, () => {
    const block = pushBlock(rawText(file));
    assert.strictEqual(block.filter((l) => l === PATHS_ANCHOR_LINE).length, 1);
    assert.deepStrictEqual(pushKeys(block), ["branches", "tags"]);
  });

  test(`${file}: 모노레포면 앵커가 paths 키로 치환돼도 tags 목록이 그대로인 유효한 push 블록이다`, () => {
    const block = pushBlock(renderInstalled(file, "spring", new Map([["spring", MONOREPO_PATH]])));
    assert.deepStrictEqual(pushKeys(block), ["branches", "tags", "paths"]);
    const tagsAt = block.indexOf("    tags:");
    assert.strictEqual(block[tagsAt + 1], "      - 'v*.*.*'", "태그 패턴이 그대로여야 합니다");
    assert.strictEqual(block[tagsAt + 2], `    paths: ['${MONOREPO_PATH}/**']`);
  });

  test(`${file}: 단일 레포면 paths 키를 만들지 않는다 (앵커 주석만 남는다)`, () => {
    const block = pushBlock(renderInstalled(file, "spring"));
    assert.deepStrictEqual(pushKeys(block), ["branches", "tags"]);
    assert.ok(block.includes(PATHS_ANCHOR_LINE));
  });

  for (const [label, paths] of [["단일 레포", new Map()], ["모노레포", new Map([["spring", MONOREPO_PATH]])]]) {
    test(`${file}: 치환된 사본이 actionlint를 통과한다 (${label}, 신규 지적 0건)`, { skip: SKIP_ACTIONLINT }, () => {
      const findings = actionlintNewFindings(renderInstalled(file, "spring", paths), file.split("/").pop(), []);
      assert.deepStrictEqual(findings, [], `actionlint 신규 지적:\n  ${findings.join("\n  ")}`);
    });
  }
}
```

- [ ] **Step 2: 실패 확인 (RED)**

```bash
node --test tests/node/ci-gate-payload.test.js
```

기대 결과: `spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`의 구조·치환 테스트 6개와 publish 2종의 "paths 앵커가 한 번 있다"·"모노레포면 … paths 키로 치환"·"단일 레포면 … 앵커 주석만 남는다" 테스트(파일당 3개)가 실패한다. Spring CI의 actionlint 테스트 2개와 publish의 actionlint 테스트(파일당 2개)는 원본이 기준선 그대로라 통과한다.

- [ ] **Step 3: NEXUS-CI 수정** (`payload/workflows/spring/nexus/PROJECT-SPRING-NEXUS-CI.yml`)

위 앵커 표에 따라 블록 A, B, C를 삽입하고 파일 끝에 블록 D를 붙인다. 기존 스텝(`if: always()`, PR 댓글, Check Run 등)은 한 줄도 바꾸지 않는다 — 위에 적은 이유로 job 수준 `if` 하나로 충분하다. 이 파일의 스텝은 들여쓰기 4칸의 `- name:` 형태지만 새로 추가하는 블록은 계약 골격(2/4/6칸)을 그대로 쓴다(YAML상 문제 없고 actionlint로 검증됨).

- [ ] **Step 4: publish 2종 수정**

`PROJECT-SPRING-NEXUS-PUBLISH.yml`과 `PROJECT-SPRING-GITHUB-PACKAGES-PUBLISH.yml` 각각에서 `      - 'v*.*.*'` 줄 바로 다음에 블록 E를 삽입한다. 다른 줄은 바꾸지 않는다. 결과 `on.push`는 다음 모양이다.

```yaml
on:
  push:
    branches: ["{{MAIN_BRANCH}}"]
    tags:
      - 'v*.*.*'
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
```

(GitHub Packages 쪽은 이 뒤에 `  workflow_dispatch:`가 이어진다.)

- [ ] **Step 5: 통과 확인 (GREEN) + 회귀 확인**

```bash
node --test tests/node/ci-gate-payload.test.js
npm run test:node
```

기대 결과: `ci-gate-payload.test.js` 51개 통과(actionlint가 없으면 15개 skip). `npm run test:node` 전체 통과(특히 `payload-yaml`, `install-matrix`, `e2e-matrix`, `deploy-style`, `workflow-action-versions`, `payload-example-values`).

publish 치환 결과를 눈으로도 확인한다.

```bash
T=$(mktemp -d)
node --input-type=module -e '
import { makeSrcText } from "./src/core/copy/workflows.js";
import { substituteEnv } from "./src/core/wizard-env.js";
import { makeResolvers } from "./src/core/detect-fs.js";
const [file, type, projectPath] = process.argv.slice(1);
const src = makeSrcText({ main: "main", develop: "develop" })(`payload/workflows/${file}`);
process.stdout.write(substituteEnv(src, { type, repoName: "demo", projectPath, resolvers: makeResolvers("/nonexistent", "demo", new Map([[type, projectPath]])) }));
' spring/nexus/PROJECT-SPRING-NEXUS-PUBLISH.yml spring services/api > "$T/PROJECT-SPRING-NEXUS-PUBLISH.yml"
sed -n 12,19p "$T/PROJECT-SPRING-NEXUS-PUBLISH.yml"   # branches / tags / '- v*.*.*' / paths: ['services/api/**']
actionlint "$T/PROJECT-SPRING-NEXUS-PUBLISH.yml"      # 기존 shellcheck 지적(SC2086, SC2193)만 나오고 새 지적 없음
rm -rf "$T"
```

### Task 18: PROJECT-FLUTTER-CI — 변경 감지·ci-gate·FLUTTER_PROJECT_DIR 정비·환경변수 모드 + 테스트 하네스 생성

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`
- Create: `tests/node/flutter-workflows-payload.test.js`

**Interfaces:**
- 소비(D1, 이미 존재해야 함): `substituteEnv`(`src/core/wizard-env.js`) — `# @wizard auto:<token>` 처리. 이 Task가 쓰는 토큰은 `project-path`, `flutter-root`, `flutter-env-mode`(값은 테스트에서 resolvers로 직접 주입하므로 `makeResolvers` 구현 여부와 무관하게 테스트가 돈다).
- 소비(기존): `makeSrcText`(`src/core/copy/workflows.js`, `{{MAIN_BRANCH}}` 치환), `scanUnsubstituted`(`src/core/verify.js`, 설치 후 미치환 `__TOKEN__` 검사).
- 이 Task가 정의하는 테스트 헬퍼(Task 19~24가 같은 파일에서 재사용): `rawWorkflow`, `renderWorkflow(filename,{flutterRoot,envMode,androidDeployMode,iosDeployMode})`, `newActionlintFindings`/`assertActionlintClean`, `jobBlocks`, `flutterBuildCommands`, `assertEveryFlutterBuildUsesDartDefine`, `assertEnvPreparedBeforeFlutterCommands`, `assertLegacyEnvStepsRemoved`, `assertWizardTokenLine`, `assertJobsUseFlutterDir`, `rootRelativeStepPaths`, `assertHashFilesScopedToFlutterRoot`, `assertNoUnsubstitutedPlaceholders`, `assertRenderedEnvMode`, `assertRenderedFlutterRoot`, `assertPathsAnchor`, `assertNoBrokenWebWizardGuide`, `assertNoFastlane`.
- 워크플로우가 노출하는 계약(다른 초안이 기대): 최상위 `env`에 `PROJECT_PATH`(`auto:project-path`), `FLUTTER_PROJECT_DIR`(`auto:flutter-root`), `ENV_MODE`(`auto:flutter-env-mode`); job `changes`(output `project`)·`ci-gate`.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**actionlint 기준선(실측, 2026-09-21, actionlint 1.7.12 + shellcheck 0.11.0):** 원본 `payload/workflows/flutter/*.yaml`을 `makeSrcText`+`substituteEnv`로 치환한 사본(`@wizard` 마커·`{{MAIN_BRANCH}}`가 그대로면 actionlint가 파싱은 되지만 값이 틀려 무의미하므로 반드시 치환본)에 돌리면 이미 다음 finding이 나온다 — 이번 변경과 무관하므로 **신규 finding만 실패로 취급**한다.
- shellcheck info/style 92건: `SC2086`(76) · `SC2129`(11) · `SC2001`(3) · `SC2015`(1) · `SC2181`(1)
- `PROJECT-FLUTTER-CI.yaml` 1건: `"github.head_ref" is potentially untrusted` (expression)
- 그 외 error/warning은 0건. `-shellcheck= -pyflakes=`로 끄면 위 expression 1건만 남는다.
- 헬퍼는 `actionlint -no-color -format '{{json .}}'`의 JSON을 읽어 위 두 패턴만 제외한다. `actionlint`가 PATH에 없으면 해당 테스트만 skip(레포 의존성으로 추가하지 않는다).
- 신규 코드가 만드는 `${DART_DEFINE_FILE:+...}` 미인용 확장은 `SC2086:info`로 기준선 코드와 같아 걸러지지 않는다 — 플래그 존재는 별도 단정(`assertEveryFlutterBuildUsesDartDefine`)이 보장한다.

**설계 결정(이 파일):**
- CI는 `.env`를 쓴다(`Create .env file` ×3: `analyze`·`build-android`·`build-ios`). `flutter build`는 `build-android`(debug APK)·`build-ios` 두 곳이라 두 곳 모두 플래그를 붙이고, 세 job 모두 `Prepare env file`로 교체한다(`analyze`는 `flutter build`는 없지만 dotenv 모드의 `build_runner`(envied 등)가 `.env`를 읽으므로 유지).
- 기존 `ENV_FILE_PATH`(사용자 커스터마이징 지점)는 dotenv 분기에서 `"$ENV_FILE_PATH"`로 존중한다(계약의 `.env` 리터럴 대신). 기본값이 `.env`라 동작은 같다.
- `PROJECT_PATH`와 `FLUTTER_PROJECT_DIR`는 같은 값으로 치환되지만(둘 다 `paths.get("flutter") || "."`) 계약(§4-1(b),(d))대로 둘 다 둔다.
- `hashFiles` 글로브는 `**/`가 레포 전체를 훑어 모노레포에서 다른 폴더의 `pubspec.lock`·`build.gradle`이 캐시 키를 흔든다 → `format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)` 등으로 Flutter 루트 아래로 한정한다(`./`로 시작해도 `@actions/glob`이 처리하고, 실패해도 키가 빈 해시가 될 뿐 워크플로우는 깨지지 않는다).
- `pull_request`/`push`/`workflow_dispatch` 모두 워크플로우는 항상 뜨고, `workflow_dispatch`는 판별을 무시한다(`github.event_name == 'workflow_dispatch' ||`).

**FLUTTER_PROJECT_DIR 전수 조사(`run:`이 아닌 경로, 원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 273·364·506 | `path: ~/.pub-cache` | 홈 경로 — 변경 없음 |
| 274·365·507 | `hashFiles('**/pubspec.lock')` | Edit 11 (3곳) |
| 372 | `path: \|` (`~/.gradle/...`) | 홈 경로 — 변경 없음 |
| 375 | `hashFiles('**/build.gradle', '**/gradle-wrapper.properties')` | Edit 12 |
| 402 | `working-directory: android` | Edit 13 |
| 그 외 | 산출물 `ls -la ./build/app/outputs/flutter-apk/`, `cd ios && pod install`, `grep ... pubspec.yaml` | `run:` — job `defaults`가 커버 |
`upload-artifact`/`download-artifact` 스텝은 이 파일에 없다.

- [ ] **Step 1: 실패하는 테스트 작성 — 하네스와 CI 케이스**

`tests/node/flutter-workflows-payload.test.js`를 **새로 만들고** 아래 전체를 그대로 쓴다.

```js
// #131: Flutter 워크플로우 7종(CI·FIREBASE·SELFHOSTED·TEST-APK·PLAYSTORE·IOS-TESTFLIGHT·IOS-TEST-TESTFLIGHT)의
// FLUTTER_PROJECT_DIR 정비, 환경변수 모드(dart-define|dotenv), fastlane 정리, main push paths 앵커를 고정한다.
// 파일별 Task가 이 파일에 케이스를 이어서 추가한다 — 아래 헬퍼를 재사용한다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { makeSrcText } from "../../src/core/copy/workflows.js";
import { substituteEnv } from "../../src/core/wizard-env.js";
import { scanUnsubstituted } from "../../src/core/verify.js";

const FLUTTER_DIR = join(resolvePayloadRoot(), "workflows", "flutter");
const BRANCHES = { main: "main", develop: "develop", mode: "pr-flow" };
const DART_DEFINE_FLAG = '${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}';

const rawWorkflow = (filename) => readFileSync(join(FLUTTER_DIR, filename), "utf8");

// 설치 경로와 같은 치환 파이프라인(makeSrcText → substituteEnv)을 거친 결과.
// resolvers 이름은 src/core/detect-fs.js makeResolvers와 같다 (계약 §4).
function renderWorkflow(
  filename,
  { flutterRoot = ".", envMode = "dart-define", androidDeployMode = "", iosDeployMode = "" } = {},
) {
  const source = makeSrcText(BRANCHES)(join(FLUTTER_DIR, filename));
  return substituteEnv(source, {
    type: "flutter",
    repoName: "sample-app",
    projectPath: flutterRoot,
    resolvers: {
      repo: () => "sample-app",
      jdk: () => "17",
      "flutter-root": () => flutterRoot,
      "project-path": () => flutterRoot,
      "flutter-env-mode": () => envMode,
      "android-deploy-mode": () => androidDeployMode,
      "ios-deploy-mode": () => iosDeployMode,
    },
  });
}

// ---- actionlint -----------------------------------------------------------------------------
// actionlint는 레포 의존성이 아니다 — PATH에 없으면 해당 테스트를 건너뛴다.
// @wizard 마커·{{MAIN_BRANCH}}는 치환 후 임시 파일에 대해 돌린다(위 renderWorkflow).
// 이 변경 이전의 파일이 이미 내던 finding(actionlint 1.7.12 + shellcheck 0.11.0 실측)은 제외하고
// 신규 finding만 실패로 본다:
//   - shellcheck info/style: SC2001 SC2015 SC2086 SC2129 SC2181 (따옴표 없는 변수·개별 리다이렉트 등)
//   - PROJECT-FLUTTER-CI.yaml의 github.head_ref inline 사용 경고
const HAS_ACTIONLINT = spawnSync("actionlint", ["-version"]).status === 0;
const BASELINE_SHELLCHECK = /\b(?:SC2001|SC2015|SC2086|SC2129|SC2181):(?:info|style)\b/;
const BASELINE_EXPRESSION = /"github\.head_ref" is potentially untrusted/;

function newActionlintFindings(filename, renderOptions) {
  const dir = mkdtempSync(join(tmpdir(), "paw-flutter-actionlint-"));
  try {
    const file = join(dir, filename);
    writeFileSync(file, renderWorkflow(filename, renderOptions));
    const result = spawnSync("actionlint", ["-no-color", "-format", "{{json .}}", file], { encoding: "utf8" });
    const findings = result.stdout.trim() ? JSON.parse(result.stdout) : [];
    return findings
      .filter((f) => !(f.kind === "shellcheck" && BASELINE_SHELLCHECK.test(f.message)))
      .filter((f) => !(f.kind === "expression" && BASELINE_EXPRESSION.test(f.message)))
      .map((f) => `${filename}:${f.line}:${f.column} [${f.kind}] ${f.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertActionlintClean(filename) {
  for (const renderOptions of [{ flutterRoot: ".", envMode: "dart-define" }, { flutterRoot: "app", envMode: "dotenv" }]) {
    assert.deepStrictEqual(newActionlintFindings(filename, renderOptions), [], `${filename} (${JSON.stringify(renderOptions)})`);
  }
}

// ---- 구조 헬퍼 ------------------------------------------------------------------------------
// "jobs:" 아래 최상위 job 블록을 Map<jobId, 블록 텍스트>로 나눈다.
function jobBlocks(text) {
  const jobsSection = text.slice(text.search(/^jobs:\s*$/m));
  const blocks = new Map();
  for (const block of jobsSection.split(/^(?=  [a-z][\w-]*:\s*$)/m).slice(1)) {
    blocks.set(block.match(/^  ([\w-]+):/)[1], block);
  }
  return blocks;
}

// `flutter build ...` 명령을 줄 이음(\)까지 이어 붙여 한 줄씩 돌려준다. echo 안의 문구는 제외.
function flutterBuildCommands(text) {
  return text
    .replace(/\\\r?\n\s*/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^flutter build \w+/.test(line));
}

function assertEveryFlutterBuildUsesDartDefine(filename, expectedBuildCount) {
  const commands = flutterBuildCommands(rawWorkflow(filename));
  assert.strictEqual(commands.length, expectedBuildCount, `${filename}: flutter build 호출 수\n  ${commands.join("\n  ")}`);
  for (const command of commands) {
    assert.ok(command.endsWith(DART_DEFINE_FLAG), `${filename}: dart-define 플래그 누락 → ${command}`);
  }
}

// flutter build 또는 build_runner를 실행하는 job은 그보다 앞에 'Prepare env file' 스텝이 있어야 한다
// (GITHUB_ENV는 job 단위라 job마다 필요하다).
function assertEnvPreparedBeforeFlutterCommands(filename, expectedJobIds) {
  const text = rawWorkflow(filename);
  const preparing = [];
  for (const [id, block] of jobBlocks(text)) {
    const firstUse = block.search(/^\s*(?:flutter build \w+|dart run build_runner)/m);
    if (firstUse === -1) continue;
    const prepareAt = block.indexOf("- name: Prepare env file");
    assert.ok(prepareAt !== -1 && prepareAt < firstUse, `${filename}: job '${id}'에 빌드보다 앞선 'Prepare env file' 스텝이 없습니다`);
    preparing.push(id);
  }
  assert.deepStrictEqual(preparing, expectedJobIds, `${filename}: Prepare env file이 필요한 job 목록`);
}

function assertLegacyEnvStepsRemoved(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!/- name: Create \.env file/.test(text), `${filename}: 'Create .env file' 스텝이 남아 있습니다`);
  assert.ok(!/- name: Ensure \.env file exists/.test(text), `${filename}: 'Ensure .env file exists' 스텝이 남아 있습니다`);
  assert.ok(!text.includes("cat << 'EOF' > ${{ env.ENV_FILE_PATH }}"), `${filename}: heredoc로 .env를 쓰는 코드가 남아 있습니다`);
}

// 최상위 env의 @wizard 토큰 줄이 계약 표기 그대로 있는가
function assertWizardTokenLine(filename, line) {
  assert.ok(rawWorkflow(filename).split("\n").includes(line), `${filename}: 다음 줄이 없습니다 → ${line}`);
}

// job에 defaults.run.working-directory가 걸려 있는가
function assertJobsUseFlutterDir(filename, jobIds) {
  const blocks = jobBlocks(rawWorkflow(filename));
  for (const id of jobIds) {
    assert.ok(blocks.has(id), `${filename}: job '${id}'가 없습니다`);
    assert.match(
      blocks.get(id),
      /^    defaults:\n      run:\n        working-directory: \$\{\{ env\.FLUTTER_PROJECT_DIR \}\}\n/m,
      `${filename}: job '${id}'에 defaults.run.working-directory가 없습니다`,
    );
  }
}

// run: 이 아닌 스텝 경로(path/file/serviceCredentialsFile, working-directory)가 레포 루트 기준으로 남아 있지 않은가.
// defaults.run.working-directory는 run 스텝에만 적용되고, 스텝 단위 working-directory와 `with:` 경로는 워크스페이스 기준이라
// ${{ env.FLUTTER_PROJECT_DIR }}/ 를 직접 붙여야 한다. allow: 의도적으로 레포 루트 기준인 줄(trim한 원문).
const ROOT_RELATIVE_STEP_PATHS = [
  /^(?:path|file|serviceCredentialsFile):\s*(?:\.\/)?(?:android|ios|build)\//,
  /^(?:path|file|serviceCredentialsFile):\s*(?:\.\/)?(?:pubspec\.yaml|firebase-service-account\.json)\s*$/,
  /^(?:\.\/)?(?:android\/|ios\/|build\/|lib\/|assets\/)\S*$/,
  /^(?:\.\/)?(?:pubspec\.yaml|build-info\.txt|build-metadata\.json)$/,
  /^working-directory:\s*(?:android|ios)\s*$/,
];
function rootRelativeStepPaths(filename, allow = []) {
  return rawWorkflow(filename)
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => ROOT_RELATIVE_STEP_PATHS.some((re) => re.test(text)) && !allow.includes(text))
    .map(({ line, text }) => `${filename}:${line}  ${text}`);
}

// 글로브가 레포 전체를 훑지 않고 Flutter 루트 아래로 한정되는가 (모노레포에서 다른 폴더의 pubspec.lock·build.gradle이 캐시 키를 흔들지 않게)
function assertHashFilesScopedToFlutterRoot(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes("hashFiles('**/"), `${filename}: hashFiles가 레포 전체를 훑습니다`);
  assert.ok(text.includes("hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR))"), `${filename}: pubspec.lock 캐시 키가 Flutter 루트로 한정되지 않았습니다`);
}

function assertNoUnsubstitutedPlaceholders(filename) {
  const dir = mkdtempSync(join(tmpdir(), "paw-flutter-unsubstituted-"));
  try {
    writeFileSync(join(dir, filename), renderWorkflow(filename, { flutterRoot: "app", envMode: "dotenv", androidDeployMode: "store_prepare", iosDeployMode: "store_submit" }));
    assert.deepStrictEqual(scanUnsubstituted(dir, [filename]), [], `${filename}: 치환 후에도 __TOKEN__ 이 남았습니다`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertRenderedEnvMode(filename) {
  for (const mode of ["dart-define", "dotenv"]) {
    assert.match(renderWorkflow(filename, { envMode: mode }), new RegExp(`^  ENV_MODE: "${mode}"\\s*$`, "m"), `${filename}: ENV_MODE=${mode}`);
  }
}

function assertRenderedFlutterRoot(filename) {
  assert.match(renderWorkflow(filename, { flutterRoot: "." }), /^  FLUTTER_PROJECT_DIR: "\."\s*$/m);
  assert.match(renderWorkflow(filename, { flutterRoot: "app" }), /^  FLUTTER_PROJECT_DIR: "app"\s*$/m);
}

// main push 앵커 → 모노레포에서 paths 필터 한 줄로 치환되고, 단일 레포에서는 주석으로 남는다.
const PATHS_ANCHOR_LINE = "    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)";
function assertPathsAnchor(filename) {
  const raw = rawWorkflow(filename);
  assert.strictEqual(raw.split("\n").filter((l) => l === PATHS_ANCHOR_LINE).length, 1, `${filename}: paths-anchor 줄`);
  assert.match(raw, /^  push:\n    branches: \["\{\{MAIN_BRANCH\}\}"\]\n    # @wizard paths-anchor/m, `${filename}: 앵커는 push.branches 바로 아래(4칸)여야 합니다`);
  assert.match(renderWorkflow(filename, { flutterRoot: "app" }), /^  push:\n    branches: \["main"\]\n    paths: \['app\/\*\*'\]\n/m, `${filename}: --paths flutter=app`);
  assert.ok(renderWorkflow(filename, { flutterRoot: "." }).includes(PATHS_ANCHOR_LINE), `${filename}: 단일 레포에서는 앵커 주석이 그대로 남는다`);
}

// 끊긴 웹 마법사 안내(레포에 없는 .github/util/flutter/...)가 남지 않았는가
function assertNoBrokenWebWizardGuide(filename) {
  const text = rawWorkflow(filename);
  assert.ok(!text.includes(".github/util/flutter"), `${filename}: 존재하지 않는 웹 마법사 경로가 남아 있습니다`);
  assert.ok(!text.includes("웹 마법사"), `${filename}: '웹 마법사' 안내가 남아 있습니다`);
}

// fastlane을 스토어 배포 전용으로 한정하는 파일(SELFHOSTED·TEST-APK): Ruby/fastlane 흔적이 없어야 한다
function assertNoFastlane(filename) {
  const text = rawWorkflow(filename);
  for (const forbidden of ["fastlane", "setup-ruby", "Gemfile", "bundle "]) {
    assert.ok(!text.includes(forbidden), `${filename}: '${forbidden}'이(가) 남아 있습니다`);
  }
}

// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-CI.yaml
// ---------------------------------------------------------------------------------------------
const CI = "PROJECT-FLUTTER-CI.yaml";

test("CI: 최상위 env에 PROJECT_PATH·FLUTTER_PROJECT_DIR·ENV_MODE @wizard 토큰이 있다", () => {
  assertWizardTokenLine(CI, '  PROJECT_PATH: "."  # @wizard auto:project-path');
  assertWizardTokenLine(CI, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(CI, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
});

test("CI: 치환 결과 — 경로·환경변수 모드가 반영된다", () => {
  assertRenderedFlutterRoot(CI);
  assertRenderedEnvMode(CI);
  assert.match(renderWorkflow(CI, { flutterRoot: "app" }), /^  PROJECT_PATH: "app"\s*$/m);
  assert.match(renderWorkflow(CI, { flutterRoot: "." }), /^  PROJECT_PATH: "\."\s*$/m);
});

test("CI: changes job이 dorny/paths-filter@v4로 PROJECT_PATH 변경 여부를 판별한다", () => {
  const changes = jobBlocks(rawWorkflow(CI)).get("changes");
  assert.ok(changes, "changes job이 없습니다");
  assert.match(changes, /uses: dorny\/paths-filter@v4/);
  assert.match(changes, /        if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}\n        uses: dorny/, "workflow_dispatch에서는 판별 스텝을 건너뛴다");
  assert.match(changes, /permissions:\n      contents: read\n      pull-requests: read\n/);
  assert.match(changes, /outputs:\n      project: \$\{\{ steps\.filter\.outputs\.project \}\}/);
  assert.ok(
    changes.includes("- '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'"),
    "필터 표현식이 계약과 다릅니다 (경로 '.'이면 '**')",
  );
});

test("CI: 기존 job은 changes에 의존하고, workflow_dispatch는 판별을 무시한다", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  for (const id of ["prepare", "analyze", "build-android", "build-ios"]) {
    const block = blocks.get(id);
    assert.match(block, /needs: (?:changes|\[changes, prepare\])\n/, `${id}: needs에 changes가 없습니다`);
    assert.ok(block.includes("github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true'"), `${id}: 변경 감지 조건이 없습니다`);
  }
  // 빌드 job은 기존 if(analyze_only·enable_*)를 잃지 않고 && 로 결합한다
  assert.ok(blocks.get("build-android").includes("needs.prepare.outputs.enable_android == 'true'"));
  assert.ok(blocks.get("build-ios").includes("needs.prepare.outputs.enable_ios == 'true'"));
  // 결과 보고는 PR 이벤트이면서 변경이 감지된 실행에서만 댓글을 갱신한다
  const report = blocks.get("report");
  assert.match(report, /if: always\(\) && github\.event_name == 'pull_request' && needs\.changes\.outputs\.project == 'true'/);
  assert.match(report, /needs: \[changes, prepare, analyze, build-android, build-ios\]/);
});

test("CI: ci-gate는 항상 실행되고 기존 모든 job을 needs로 집계한다", () => {
  const blocks = jobBlocks(rawWorkflow(CI));
  const gate = blocks.get("ci-gate");
  assert.ok(gate, "ci-gate job이 없습니다");
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
  const others = [...blocks.keys()].filter((id) => id !== "ci-gate");
  const needs = gate.match(/needs: \[([^\]]+)\]/)[1].split(",").map((s) => s.trim());
  assert.deepStrictEqual([...needs].sort(), [...others].sort(), "ci-gate needs가 모든 job을 포함해야 합니다");
  assert.ok(gate.includes("RESULTS: ${{ toJSON(needs.*.result) }}"));
  assert.ok(gate.includes(`grep -Eq '"(failure|cancelled)"'`));
});

test("CI: 환경변수 모드 — analyze·build-android·build-ios 모두 Prepare env file, flutter build에 dart-define 플래그", () => {
  assertLegacyEnvStepsRemoved(CI);
  assertEnvPreparedBeforeFlutterCommands(CI, ["analyze", "build-android", "build-ios"]);
  assertEveryFlutterBuildUsesDartDefine(CI, 2);
  // 기존 ENV_FILE_PATH 커스터마이징은 dotenv 분기에서 그대로 존중한다
  assert.ok(rawWorkflow(CI).includes(`printf '%s\\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"`));
});

test("CI: FLUTTER_PROJECT_DIR — 빌드·분석 job은 defaults를 쓰고 스텝 경로는 루트 접두를 붙인다", () => {
  assertJobsUseFlutterDir(CI, ["analyze", "build-android", "build-ios"]);
  assert.ok(rawWorkflow(CI).includes("      - name: Setup Gradle\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(CI), []);
  assertHashFilesScopedToFlutterRoot(CI);
});

test("CI: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(CI);
  assertActionlintClean(CI);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: CI 케이스 7개 FAIL(토큰 줄·`changes`·`ci-gate`·`Prepare env file`·`defaults` 없음 등), `CI: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다`는 **PASS**(기준선 회귀 가드라 원본에서도 통과 — 이후 Task에서 신규 경고가 생기면 여기서 잡힌다). `actionlint`가 없으면 그 케이스는 skipped.

- [ ] **Step 3: `PROJECT-FLUTTER-CI.yaml` 수정**

**Edit 1 — 헤더 주석 — 설정 항목 설명**

앵커(기존 원문):

```yaml
# ENV_FILE_PATH   : .env 파일 경로 (기본값: 루트의 .env)
```

교체 후:

```yaml
# ENV_FILE_PATH   : dotenv 모드에서 .env를 만들 경로 (Flutter 루트 기준, 기본값: .env)
# ENV_MODE        : 환경변수 전달 방식 — dart-define(--dart-define-from-file) | dotenv(.env 파일)
# FLUTTER_PROJECT_DIR : Flutter 루트 경로 (설치 시 자동 설정, 모노레포는 app 등)
# PROJECT_PATH    : 변경 감지 기준 경로 (설치 시 자동 설정, "."이면 항상 실행)
```

**Edit 2 — 헤더 주석 — ci-gate 안내**

앵커(기존 원문):

```yaml
# ※ CI는 빌드 검증 목적이므로 서명/배포 관련 Secrets 불필요
```

교체 후:

```yaml
# ※ CI는 빌드 검증 목적이므로 서명/배포 관련 Secrets 불필요
# ※ 모노레포에서 이 CI를 required check로 쓰려면 개별 job이 아니라 `ci-gate` 하나만 등록하세요.
#    (경로가 바뀌지 않아 건너뛴 job은 Success로 집계되고, ci-gate가 최종 결과를 판정합니다)
```

**Edit 3 — 최상위 env — PROJECT_PATH·FLUTTER_PROJECT_DIR·ENV_MODE 추가**

앵커(기존 원문):

```yaml
env:
  # 🎯 CI 모드 설정
```

교체 후:

```yaml
env:
  # 🎯 모노레포 변경 감지 경로 (설치 시 자동 설정, 단일 레포는 ".")
  PROJECT_PATH: "."  # @wizard auto:project-path
  # Flutter 루트 경로(레포 루트 기준). 단일레포면 ".", 모노레포면 "app" 등 — 설치 시 자동 설정
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode

  # 🎯 CI 모드 설정
```

**Edit 4 — ENV_FILE_PATH 주석**

앵커(기존 원문):

```yaml
  ENV_FILE_PATH: ".env"     # 환경변수 파일 경로 (커스터마이징 가능)
```

교체 후:

```yaml
  ENV_FILE_PATH: ".env"     # dotenv 모드에서 .env를 만들 경로 (Flutter 루트 기준, 커스터마이징 가능)
```

**Edit 5 — changes job 추가 (jobs: 바로 아래)**

앵커(기존 원문):

```yaml
jobs:
  # ===================================================================
  # Job 1: 준비 단계
```

교체 후:

```yaml
jobs:
  # ===================================================================
  # Job 0: 변경 감지 (PROJECT_PATH 아래가 바뀌었을 때만 이후 job 실행)
  # ===================================================================
  changes:
    name: 변경 감지
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    outputs:
      project: ${{ steps.filter.outputs.project }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: 프로젝트 경로 변경 여부 판별
        id: filter
        if: ${{ github.event_name != 'workflow_dispatch' }}
        uses: dorny/paths-filter@v4
        with:
          filters: |
            project:
              - '${{ env.PROJECT_PATH == '.' && '**' || format('{0}/**', env.PROJECT_PATH) }}'

  # ===================================================================
  # Job 1: 준비 단계
```

**Edit 6 — prepare job — needs/if**

앵커(기존 원문):

```yaml
  prepare:
    name: CI 준비
    runs-on: ubuntu-latest

    outputs:
```

교체 후:

```yaml
  prepare:
    name: CI 준비
    needs: changes
    if: ${{ (github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true') }}
    runs-on: ubuntu-latest

    outputs:
```

**Edit 7 — analyze job — needs/if/defaults**

앵커(기존 원문):

```yaml
  analyze:
    name: 코드 분석
    runs-on: ubuntu-latest
    needs: prepare
```

교체 후:

```yaml
  analyze:
    name: 코드 분석
    runs-on: ubuntu-latest
    needs: [changes, prepare]
    if: ${{ (github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true') }}
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 8 — build-android job — if 결합/needs/defaults**

앵커(기존 원문):

```yaml
    if: |
      needs.prepare.outputs.analyze_only != 'true' &&
      needs.prepare.outputs.enable_android == 'true'
    runs-on: ubuntu-latest
    needs: prepare
```

교체 후:

```yaml
    if: |
      (github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true') &&
      needs.prepare.outputs.analyze_only != 'true' &&
      needs.prepare.outputs.enable_android == 'true'
    runs-on: ubuntu-latest
    needs: [changes, prepare]
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 9 — build-ios job — if 결합/needs/defaults**

앵커(기존 원문):

```yaml
    if: |
      needs.prepare.outputs.analyze_only != 'true' &&
      needs.prepare.outputs.enable_ios == 'true'
    runs-on: macos-26
    needs: prepare
```

교체 후:

```yaml
    if: |
      (github.event_name == 'workflow_dispatch' || needs.changes.outputs.project == 'true') &&
      needs.prepare.outputs.analyze_only != 'true' &&
      needs.prepare.outputs.enable_ios == 'true'
    runs-on: macos-26
    needs: [changes, prepare]
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 10 — Create .env file → Prepare env file (analyze·build-android·build-ios 3곳 전부)**

파일 안에서 아래 앵커가 **정확히 3곳** 동일하게 나온다. 모두 같은 내용으로 교체한다(`replace_all`). 교체 후 `grep -c` 로 3곳이 바뀌었는지 확인한다.

앵커(기존 원문):

```yaml
      # .env 파일 생성
      - name: Create .env file
        run: |
          cat << 'EOF' > ${{ env.ENV_FILE_PATH }}
          ${{ secrets.ENV_FILE || secrets.ENV }}
          EOF
          echo "✅ ${{ env.ENV_FILE_PATH }} file created"
```

교체 후:

```yaml
      # 환경변수 준비 — ENV_MODE=dotenv면 .env 파일, dart-define이면 프로젝트 밖 임시 파일(--dart-define-from-file)
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"
            echo "✅ $ENV_FILE_PATH file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 11 — Flutter pub 캐시 키 (3곳 전부)**

파일 안에서 아래 앵커가 **정확히 3곳** 동일하게 나온다. 모두 같은 내용으로 교체한다(`replace_all`). 교체 후 `grep -c` 로 3곳이 바뀌었는지 확인한다.

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 12 — Gradle 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/build.gradle', '**/gradle-wrapper.properties') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles(format('{0}/android/**/build.gradle', env.FLUTTER_PROJECT_DIR), format('{0}/android/**/gradle-wrapper.properties', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 13 — Setup Gradle 스텝 working-directory**

앵커(기존 원문):

```yaml
      - name: Setup Gradle
        working-directory: android
```

교체 후:

```yaml
      - name: Setup Gradle
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android
```

**Edit 14 — flutter build apk --debug**

앵커(기존 원문):

```yaml
          flutter build apk --debug
```

교체 후:

```yaml
          flutter build apk --debug ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 15 — flutter build ios**

앵커(기존 원문):

```yaml
          flutter build ios --release --no-codesign
```

교체 후:

```yaml
          flutter build ios --release --no-codesign ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 16 — report job — if 결합/needs**

앵커(기존 원문):

```yaml
    if: always() && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    needs: [prepare, analyze, build-android, build-ios]
```

교체 후:

```yaml
    if: always() && github.event_name == 'pull_request' && needs.changes.outputs.project == 'true'
    runs-on: ubuntu-latest
    needs: [changes, prepare, analyze, build-android, build-ios]
```

**Edit 17 — ci-gate job 추가 (파일 끝)**

앵커(기존 원문):

```yaml
            } else {
              console.log('⚠️ 댓글 ID가 없어 업데이트를 건너뜁니다.');
            }
```

교체 후:

```yaml
            } else {
              console.log('⚠️ 댓글 ID가 없어 업데이트를 건너뜁니다.');
            }

  # ===================================================================
  # Job 6: CI Gate (required check로 등록할 단일 진입점)
  # ===================================================================
  # 건너뛴(skipped) job은 통과로 보고 failure/cancelled가 하나라도 있으면 실패한다.
  ci-gate:
    name: CI Gate
    if: ${{ always() }}
    needs: [changes, prepare, analyze, build-android, build-ios, report]
    runs-on: ubuntu-latest
    steps:
      - name: 결과 집계
        env:
          RESULTS: ${{ toJSON(needs.*.result) }}
        run: |
          echo "needs 결과: $RESULTS"
          if echo "$RESULTS" | grep -Eq '"(failure|cancelled)"'; then
            echo "실패하거나 취소된 job이 있습니다."
            exit 1
          fi
```


수정 후 자체 점검(모두 통과해야 한다):
```bash
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml          # 3
grep -c "Create .env file" payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml          # 0
grep -c 'dart-define-from-file' payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml     # 2
grep -n "hashFiles('\*\*/" payload/workflows/flutter/PROJECT-FLUTTER-CI.yaml          # 출력 없음
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 8개 전부 PASS (actionlint 설치 시). 실패하면 메시지의 줄 번호로 해당 Edit를 다시 대조한다.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS. 특히 `payload-yaml.test.js`의 `PROJECT-FLUTTER-CI` 케이스(`flutter build apk --debug` 포함·`--release` 미포함, `Install iOS device platform`이 `Select Xcode version` 뒤, `flutter pub get` 직후 `build_runner` 가드)가 그대로 통과해야 한다 — 이번 수정은 `flutter pub get` 블록과 `flutter build apk --debug` 문자열 앞부분을 건드리지 않는다.

### Task 19: PROJECT-FLUTTER-ANDROID-FIREBASE-CICD — main push 앵커·FLUTTER_PROJECT_DIR 정비·환경변수 모드·웹 마법사 안내 삭제

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (FIREBASE 케이스 추가)

**Interfaces:**
- 소비: Task 18이 만든 헬퍼(`assertPathsAnchor`, `assertEnvPreparedBeforeFlutterCommands`, `assertJobsUseFlutterDir`, `rootRelativeStepPaths`, `assertHashFilesScopedToFlutterRoot`, `assertNoBrokenWebWizardGuide`, `assertActionlintClean` …) — 헬퍼를 다시 정의하지 않는다.
- 소비(D1): `substituteEnv`의 `paths-anchor` 치환(기존 동작, `projectPath !== "."`일 때 `paths: ['<경로>/**']`), `auto:flutter-root`·`auto:flutter-env-mode`.
- 워크플로우가 노출: 최상위 `env.FLUTTER_PROJECT_DIR`, `env.ENV_MODE`; `on.push.paths-anchor`.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- `prepare-build`·`build-android`에 `defaults.run.working-directory`를 건다. `deploy-firebase`는 Flutter 명령을 실행하지 않고(AAB를 내려받아 Firebase 액션으로 올릴 뿐) `truncate_release_notes.py`·`firebase-service-account.json`이 레포 루트 기준이므로 **defaults를 걸지 않는다** — 대신 AAB 경로에만 접두를 붙인다.
- `prepare-build`의 버전·릴리즈 노트 스텝은 `version.yml`·`CHANGELOG.json`·`final_release_notes.txt`(upload 짝)가 레포 루트 기준이라 PLAYSTORE와 같이 스텝 단위 `working-directory: ${{ github.workspace }}`를 쓴다.
- `prepare-build`도 `Prepare env file`을 둔다(`flutter pub get` 뒤 `build_runner`가 dotenv 모드에서 `.env`를 읽는다).
- 헤더의 끊긴 웹 마법사 2줄은 삭제하고 Secrets 등록 위치 안내로 대체한다(필요한 Secrets 목록은 바로 위에 이미 있다).

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 110·267 | `path: ~/.pub-cache` | 변경 없음 |
| 111·268 | `hashFiles('**/pubspec.lock')` | Edit 6 (2곳) |
| 185 | `path: final_release_notes.txt` | 레포 루트(릴리즈 노트 스텝이 workspace에서 생성) — 변경 없음 |
| 194–197 | project-files `path: \|` (pubspec.yaml/lib/assets) | Edit 10 |
| 220 | `download project-files path: .` | Edit 12 |
| 287–290 | gradle 캐시 `path`(`~/.gradle`)·`hashFiles('**/build.gradle*', ...)` | key만 Edit 7 |
| 527 | `upload android-aab path: build/app/outputs/bundle/release/app-release.aab` | Edit 15 |
| 547 | `download android-aab path: build/app/outputs/bundle/release/` | Edit 16 |
| 554 | `download release-notes path: .` | 레포 루트 — 변경 없음 |
| 576 | `serviceCredentialsFile: firebase-service-account.json` | deploy 잡(cwd = 레포 루트, 자격증명 파일도 루트에 생성) — 변경 없음, 테스트 allow 목록에 명시 |
| 578 | `file: build/app/outputs/.../app-release.aab` | Edit 17 |
| 579 | `releaseNotesFile: final_release_notes.txt` | 레포 루트 — 변경 없음 |
`run:` 안의 상대경로(`android/app/keystore`, `build/app/outputs/...`, `pubspec.yaml`)는 `build-android` job의 `defaults`가 커버한다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` **끝에** 아래를 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml
// ---------------------------------------------------------------------------------------------
const FIREBASE = "PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml";

test("FIREBASE: main push paths 앵커 — 모노레포에서 paths 필터로 치환된다", () => {
  assertPathsAnchor(FIREBASE);
});

test("FIREBASE: FLUTTER_PROJECT_DIR·ENV_MODE 토큰과 치환 결과", () => {
  assertWizardTokenLine(FIREBASE, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(FIREBASE, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(FIREBASE);
  assertRenderedEnvMode(FIREBASE);
});

test("FIREBASE: 환경변수 모드 — 빌드 job마다 Prepare env file, appbundle에 dart-define 플래그", () => {
  assertLegacyEnvStepsRemoved(FIREBASE);
  assertEnvPreparedBeforeFlutterCommands(FIREBASE, ["prepare-build", "build-android"]);
  assertEveryFlutterBuildUsesDartDefine(FIREBASE, 1);
});

test("FIREBASE: FLUTTER_PROJECT_DIR 정비 — 레포 루트 기준 스텝은 워크스페이스로, 나머지는 접두를 붙인다", () => {
  assertJobsUseFlutterDir(FIREBASE, ["prepare-build", "build-android"]);
  const blocks = jobBlocks(rawWorkflow(FIREBASE));
  // version.yml·changelog는 레포 루트 기준
  const prepare = blocks.get("prepare-build");
  assert.match(prepare, /name: 현재 버전 정보 가져오기\n        id: current_version\n        working-directory: \$\{\{ github\.workspace \}\}/);
  assert.match(prepare, /name: 릴리즈 노트 생성\n        id: release_notes\n        working-directory: \$\{\{ github\.workspace \}\}/);
  // deploy 잡은 Flutter를 실행하지 않는다 — defaults 없이 AAB 경로에만 접두
  assert.ok(!blocks.get("deploy-firebase").includes("defaults:"));
  const text = rawWorkflow(FIREBASE);
  assert.ok(text.includes("file: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab"));
  assert.ok(text.includes("path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/\n"));
  assert.deepStrictEqual(
    rootRelativeStepPaths(FIREBASE, ["serviceCredentialsFile: firebase-service-account.json"]),
    [],
  );
  assertHashFilesScopedToFlutterRoot(FIREBASE);
});

test("FIREBASE: 끊긴 웹 마법사 안내가 없고 필요한 Secrets 안내가 남는다", () => {
  assertNoBrokenWebWizardGuide(FIREBASE);
  assert.ok(rawWorkflow(FIREBASE).includes("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"));
});

test("FIREBASE: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(FIREBASE);
  assertActionlintClean(FIREBASE);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: FIREBASE 케이스 5개 FAIL(앵커·토큰·`Prepare env file`·`defaults`·웹 마법사 문구), `FIREBASE: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다`는 PASS. Task 18 케이스는 계속 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` 수정**

**Edit 1 — 헤더 — 끊긴 웹 마법사 안내 삭제**

앵커(기존 원문):

```yaml
# 🪄 빠른 설정: .github/util/flutter/firebase-wizard/firebase-wizard.html을
#    브라우저에서 열어 5단계 마법사로 Firebase 배포를 자동 설정할 수 있습니다.
```

교체 후:

```yaml
# ※ 위 Secrets는 저장소 Settings → Secrets and variables → Actions에 등록하세요.
#    FIREBASE_APP_ID·FIREBASE_TESTER_GROUP은 아래 env 섹션 값을 직접 수정합니다.
```

**Edit 2 — on.push paths 앵커**

앵커(기존 원문):

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
  workflow_dispatch:
```

교체 후:

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
  workflow_dispatch:
```

**Edit 3 — env — FLUTTER_PROJECT_DIR·ENV_MODE 추가**

앵커(기존 원문):

```yaml
  PROJECT_TYPE: "flutter"
  # Firebase App Distribution 설정
```

교체 후:

```yaml
  PROJECT_TYPE: "flutter"
  # Flutter 루트 경로(레포 루트 기준). 단일레포면 ".", 모노레포면 "app" 등 — 설치 시 자동 설정
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  # Firebase App Distribution 설정
```

**Edit 4 — prepare-build defaults**

앵커(기존 원문):

```yaml
    name: 환경 설정 및 준비
    runs-on: ubuntu-latest
```

교체 후:

```yaml
    name: 환경 설정 및 준비
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 5 — prepare-build: Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > .env
          echo ".env file created"
```

교체 후:

```yaml
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > .env
            echo ".env file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 6 — Flutter pub 캐시 키 (2곳 전부)**

파일 안에서 아래 앵커가 **정확히 2곳** 동일하게 나온다. 모두 같은 내용으로 교체한다(`replace_all`). 교체 후 `grep -c` 로 2곳이 바뀌었는지 확인한다.

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 7 — Gradle 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/build.gradle*', '**/gradle-wrapper.properties') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles(format('{0}/android/**/build.gradle*', env.FLUTTER_PROJECT_DIR), format('{0}/android/**/gradle-wrapper.properties', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 8 — 현재 버전 정보 스텝 — 레포 루트에서 실행**

앵커(기존 원문):

```yaml
      - name: 현재 버전 정보 가져오기
        id: current_version
        run: |
```

교체 후:

```yaml
      - name: 현재 버전 정보 가져오기
        id: current_version
        working-directory: ${{ github.workspace }}   # version_manager.py가 레포 루트 version.yml을 읽어야 함
        run: |
```

**Edit 9 — 릴리즈 노트 스텝 — 레포 루트에서 실행**

앵커(기존 원문):

```yaml
      - name: 릴리즈 노트 생성
        id: release_notes
        run: |
```

교체 후:

```yaml
      - name: 릴리즈 노트 생성
        id: release_notes
        working-directory: ${{ github.workspace }}   # CHANGELOG.json·changelog_manager.py·final_release_notes.txt(upload 짝)는 레포 루트 기준
        run: |
```

**Edit 10 — Upload project files 경로**

앵커(기존 원문):

```yaml
          path: |
            pubspec.yaml
            lib/
            assets/
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml
            ${{ env.FLUTTER_PROJECT_DIR }}/lib/
            ${{ env.FLUTTER_PROJECT_DIR }}/assets/
```

**Edit 11 — build-android defaults**

앵커(기존 원문):

```yaml
    name: Android AAB 빌드
    runs-on: ubuntu-latest
    needs: prepare-build
```

교체 후:

```yaml
    name: Android AAB 빌드
    runs-on: ubuntu-latest
    needs: prepare-build
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 12 — Download project files 경로**

앵커(기존 원문):

```yaml
          name: project-files
          path: .
```

교체 후:

```yaml
          name: project-files
          path: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 13 — build-android: Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      # .env 파일 생성 (보안을 위해 아티팩트가 아닌 시크릿에서 생성)
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > .env
          echo "✅ .env 파일 생성됨 (크기: $(wc -c < .env) bytes)"
```

교체 후:

```yaml
      # 환경변수 준비 (보안을 위해 아티팩트가 아닌 시크릿에서 생성) — ENV_MODE=dotenv면 .env 파일, dart-define이면 임시 파일
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > .env
            echo ".env file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 14 — flutter build appbundle**

앵커(기존 원문):

```yaml
            --build-number="$VERSION_CODE" \
            --verbose
```

교체 후:

```yaml
            --build-number="$VERSION_CODE" \
            --verbose \
            ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 15 — Upload AAB artifact 경로**

앵커(기존 원문):

```yaml
          path: build/app/outputs/bundle/release/app-release.aab
```

교체 후:

```yaml
          path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab
```

**Edit 16 — deploy-firebase: Download AAB artifact 경로**

앵커(기존 원문):

```yaml
          name: android-aab
          path: build/app/outputs/bundle/release/
```

교체 후:

```yaml
          name: android-aab
          path: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/
```

**Edit 17 — deploy-firebase: 자격증명·AAB 경로**

앵커(기존 원문):

```yaml
          serviceCredentialsFile: firebase-service-account.json
          groups: ${{ env.FIREBASE_TESTER_GROUP }}
          file: build/app/outputs/bundle/release/app-release.aab
```

교체 후:

```yaml
          serviceCredentialsFile: firebase-service-account.json
          groups: ${{ env.FIREBASE_TESTER_GROUP }}
          file: ${{ env.FLUTTER_PROJECT_DIR }}/build/app/outputs/bundle/release/app-release.aab
```


수정 후 자체 점검:
```bash
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml   # 2
grep -c "util/flutter" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml       # 0
grep -n "paths-anchor" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml       # 1줄, 4칸 들여쓰기
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS (`payload-yaml.test.js`의 `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD: flutter pub get 직후 build_runner 조건부 코드 생성` 케이스 포함 — `flutter pub get` 블록은 건드리지 않았다).

### Task 20: PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD — main push 앵커·FLUTTER_PROJECT_DIR 정비·환경변수 모드·fastlane 제거

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (SELFHOSTED 케이스 추가)

**Interfaces:**
- 소비: Task 18 헬퍼(`assertPathsAnchor`, `assertNoFastlane`, `flutterBuildCommands`, `assertEnvPreparedBeforeFlutterCommands`, …).
- 소비(D1): `paths-anchor` 치환, `auto:flutter-root`, `auto:flutter-env-mode`.
- 워크플로우가 노출: `env.FLUTTER_PROJECT_DIR`, `env.ENV_MODE`, `on.push.paths-anchor`. Ruby·fastlane 의존이 없어진다(`fastlane`·`setup-ruby`·`Gemfile`·`bundle ` 문자열 0).

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- Ruby 설정 → Ruby 확인 → fastlane 설치 → `fastlane build` 4개 스텝을 없애고 `flutter build apk --release`를 직접 실행한다(`--verbose`는 fastlane lane 내용을 알 수 없어 옮기지 않는다. 필요하면 사용자가 붙인다). Java 설정은 Gradle에 필요하므로 유지한다.
- 산출물 경로 검증: 이후 `Rename and Prepare APK`의 `./build/app/outputs/flutter-apk/app-release.apk`와 `./android/app/build/outputs/apk/release/`는 `run:`이라 `defaults`(= Flutter 루트) 기준으로 그대로 맞는다. `Upload APK as Artifact`의 `path:`는 워크스페이스 기준이라 접두를 붙이고(Edit 10), `deploy-android` 잡은 아티팩트를 **자기 워크스페이스의** `android/app/build/outputs/`로 내려받아 `find`·`smbclient put`으로 올리므로 Flutter 루트와 무관 — 변경하지 않는다(테스트가 `FLUTTER_PROJECT_DIR` 미참조를 고정).
- 이 파일에는 `.env`를 쓰는 스텝이 `build-android`에 하나(`Create .env file from GitHub Secret`)뿐이다.
- 발견(수정하지 않음): `deploy-android`가 참조하는 `env.SMB_PATH_ANDROID`가 `env:`에 정의돼 있지 않다(`SMB_PATH_IOS`만 있음). 이슈 범위 밖의 기존 결함이라 손대지 않고 최종 보고에만 남긴다.

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 119 | `path: ~/.pub-cache` | 변경 없음 |
| 120 | `hashFiles('**/pubspec.lock')` | Edit 5 |
| 126–129 | gradle 캐시 `path`(`~/.gradle`)·`hashFiles('**/build.gradle', ...)` | key만 Edit 6 |
| 145 | `working-directory: android` (Setup Gradle) | Edit 7 |
| 175 | `working-directory: android` (Install Fastlane) | Edit 8에서 스텝째 삭제 |
| 221 | `upload-artifact path: ./android/app/build/outputs/apk/release/...apk` | Edit 10 |
| 249 | `download-artifact path: android/app/build/outputs/` (deploy-android) | 별도 잡의 자체 경로 — 변경 없음, 테스트 allow 목록에 명시 |

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` 끝에 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml
// ---------------------------------------------------------------------------------------------
const SELFHOSTED = "PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml";

test("SELFHOSTED: main push paths 앵커 — 모노레포에서 paths 필터로 치환된다", () => {
  assertPathsAnchor(SELFHOSTED);
});

test("SELFHOSTED: fastlane 없이 flutter build apk --release를 직접 실행한다", () => {
  assertNoFastlane(SELFHOSTED);
  const commands = flutterBuildCommands(rawWorkflow(SELFHOSTED));
  assert.deepStrictEqual(commands, [`flutter build apk --release ${DART_DEFINE_FLAG}`]);
  assert.ok(!rawWorkflow(SELFHOSTED).includes("fastlane build"));
});

test("SELFHOSTED: FLUTTER_PROJECT_DIR·ENV_MODE 토큰과 치환 결과", () => {
  assertWizardTokenLine(SELFHOSTED, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(SELFHOSTED, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(SELFHOSTED);
  assertRenderedEnvMode(SELFHOSTED);
});

test("SELFHOSTED: 환경변수 모드 — build-android에 Prepare env file", () => {
  assertLegacyEnvStepsRemoved(SELFHOSTED);
  assert.ok(!rawWorkflow(SELFHOSTED).includes("Create .env file from GitHub Secret"));
  assertEnvPreparedBeforeFlutterCommands(SELFHOSTED, ["build-android"]);
  assertEveryFlutterBuildUsesDartDefine(SELFHOSTED, 1);
});

test("SELFHOSTED: 산출물 경로가 FLUTTER_PROJECT_DIR 기준으로 이어진다 (mv → 업로드 → SMB 업로드)", () => {
  assertJobsUseFlutterDir(SELFHOSTED, ["build-android"]);
  const text = rawWorkflow(SELFHOSTED);
  // build-android(cwd = Flutter 루트): flutter가 만든 산출물을 옮긴다
  assert.ok(text.includes("mv ./build/app/outputs/flutter-apk/app-release.apk ./android/app/build/outputs/apk/release/"));
  // 아티팩트 업로드는 워크스페이스 기준이라 접두를 붙인다
  assert.ok(text.includes("path: ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/${{ env.APP_ARTIFACT_NAME }}-v"));
  // deploy-android는 아티팩트를 자기 워크스페이스 경로로 내려받아 SMB로 올린다 — Flutter 루트와 무관
  const deploy = jobBlocks(text).get("deploy-android");
  assert.ok(!deploy.includes("FLUTTER_PROJECT_DIR"));
  assert.ok(deploy.includes("path: android/app/build/outputs/"));
  assert.deepStrictEqual(rootRelativeStepPaths(SELFHOSTED, ["path: android/app/build/outputs/"]), []);
  assertHashFilesScopedToFlutterRoot(SELFHOSTED);
});

test("SELFHOSTED: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(SELFHOSTED);
  assertActionlintClean(SELFHOSTED);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: SELFHOSTED 케이스 5개 FAIL(앵커·fastlane 잔존·토큰·`Prepare env file`·산출물 경로), 마지막 actionlint 케이스는 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml` 수정**

**Edit 1 — on.push paths 앵커**

앵커(기존 원문):

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
  workflow_dispatch: # 수동 실행 옵션 추가
```

교체 후:

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
  workflow_dispatch: # 수동 실행 옵션 추가
```

**Edit 2 — env — FLUTTER_PROJECT_DIR·ENV_MODE 추가**

앵커(기존 원문):

```yaml
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:17
  # SMB 서버 설정
```

교체 후:

```yaml
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:17
  # Flutter 루트 경로(레포 루트 기준). 단일레포면 ".", 모노레포면 "app" 등 — 설치 시 자동 설정
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  # SMB 서버 설정
```

**Edit 3 — build-android defaults**

앵커(기존 원문):

```yaml
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name != 'workflow_run' }}
```

교체 후:

```yaml
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name != 'workflow_run' }}
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 4 — Create .env file from GitHub Secret → Prepare env file**

앵커(기존 원문):

```yaml
      # .env 파일 생성
      - name: Create .env file from GitHub Secret
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > .env
          echo ".env file created"
          ls -la
```

교체 후:

```yaml
      # 환경변수 준비 — ENV_MODE=dotenv면 .env 파일, dart-define이면 프로젝트 밖 임시 파일(--dart-define-from-file)
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > .env
            echo ".env file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 5 — Flutter pub 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 6 — Gradle 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/build.gradle', '**/gradle-wrapper.properties') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles(format('{0}/android/**/build.gradle', env.FLUTTER_PROJECT_DIR), format('{0}/android/**/gradle-wrapper.properties', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 7 — Setup Gradle 스텝 working-directory**

앵커(기존 원문):

```yaml
      - name: Setup Gradle
        working-directory: android
```

교체 후:

```yaml
      - name: Setup Gradle
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android
```

**Edit 8 — Ruby·Fastlane 설치 스텝 삭제**

앵커(기존 원문):

```yaml
      # Ruby 설정 및 확인
      - name: Set up Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.4.1"

      - name: Verify Ruby version
        run: |
          echo "Ruby setup completed"
          ruby -v

      # Fastlane 설치 (Bundler 방식 - gem 충돌 방지)
      - name: Install Fastlane
        working-directory: android
        run: |
          # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
          printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          bundle install
          echo "Fastlane installed (Bundler)"
          bundle exec fastlane --version

```

교체: **삭제** (앵커 블록 전체를 지우고, 앞뒤 빈 줄이 한 줄만 남게 한다)

**Edit 9 — fastlane build → flutter build apk --release 직접 실행**

앵커(기존 원문):

```yaml
      # Fastlane을 이용하여 APK 빌드 (릴리스 빌드 유지)
      - name: Build APK with Fastlane
        run: |
          cd android
          bundle exec fastlane build --verbose
          ls -la ../build/app/outputs/flutter-apk/ || true
          echo "APK built with Fastlane"
```

교체 후:

```yaml
      # APK 빌드 (릴리스 빌드 유지 — flutter로 직접 빌드)
      - name: Build APK
        run: |
          flutter build apk --release ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
          ls -la build/app/outputs/flutter-apk/ || true
          echo "APK built"
```

**Edit 10 — Upload APK as Artifact 경로**

앵커(기존 원문):

```yaml
          path: ./android/app/build/outputs/apk/release/${{ env.APP_ARTIFACT_NAME }}-v${{ env.VERSION }}-${{ env.SHORT_COMMIT_HASH }}.apk
```

교체 후:

```yaml
          path: ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/${{ env.APP_ARTIFACT_NAME }}-v${{ env.VERSION }}-${{ env.SHORT_COMMIT_HASH }}.apk
```


수정 후 자체 점검:
```bash
grep -n -i "fastlane\|ruby\|Gemfile\|bundle " payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml   # 출력 없음
grep -n "flutter build" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD.yaml                          # flutter build apk --release ${DART_DEFINE_FILE:+...} 1줄
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS (`SELFHOSTED: flutter pub get 직후 build_runner 조건부 코드 생성` 케이스 포함).

### Task 21: PROJECT-FLUTTER-ANDROID-TEST-APK — FLUTTER_PROJECT_DIR 정비·환경변수 모드·fastlane 제거·웹 마법사 안내 삭제

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (TEST-APK 케이스 추가)

**Interfaces:**
- 소비: Task 18 헬퍼.
- 소비(D1): `auto:flutter-root`, `auto:flutter-env-mode`. (이 워크플로우는 `workflow_dispatch`/`repository_dispatch` 전용이라 main push 앵커가 없다.)
- 워크플로우가 노출: `env.FLUTTER_PROJECT_DIR`, `env.ENV_MODE`. `fastlane`·`setup-ruby`·`Gemfile`·`bundle ` 문자열 0, `android/fastlane/Fastfile` 분기 없음.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- `build-android-test` job에만 `defaults`를 건다. `prepare-test-build`는 `version_manager.py`(레포 루트 `version.yml`)와 이슈 정보 조회만 하고 `FLUTTER_PROJECT_DIR`와 무관하므로 **건드리지 않는다**(테스트가 미참조를 고정).
- `Build APK`는 "Fastfile 있으면 fastlane, 없으면 flutter" 분기를 지우고 `flutter build apk --release` + 플래그만 남긴다.
- `Create build info file`·`Create build metadata file`은 cwd(= Flutter 루트)에 파일을 쓰므로 `upload-artifact` 경로를 `${{ env.FLUTTER_PROJECT_DIR }}/build-info.txt` 등으로 맞춘다. 아티팩트 내부 구조(LCA가 Flutter 루트)는 종전과 같다(`android/app/build/outputs/apk/release/*.apk`, `build-info.txt`, `build-metadata.json`).
- Firebase 업로드: 자격증명 파일은 `run:`(cwd = Flutter 루트)이 만들고 `wzieba` 액션이 워크스페이스 기준으로 읽으므로 `serviceCredentialsFile`·`file`에 접두를 붙인다. 삭제 스텝(`rm -f firebase-service-account.json`)은 `run:`이라 그대로 맞는다.

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 373 | `path: ~/.pub-cache` | 변경 없음 |
| 374 | `hashFiles('**/pubspec.lock')` | Edit 5 |
| 380–383 | gradle 캐시 `path`(`~/.gradle`)·`hashFiles('**/build.gradle', ...)` | key만 Edit 6 |
| 398 | `working-directory: android` (Setup Gradle) | Edit 7 |
| 429 | `working-directory: android` (Install Fastlane) | Edit 8에서 스텝째 삭제 |
| 695–698 | `upload-artifact path: \|` (`./android/...*.apk`, `build-info.txt`, `build-metadata.json`) | Edit 10 |
| 733 | `serviceCredentialsFile: firebase-service-account.json` | Edit 11 |
| 735 | `file: ./android/app/build/outputs/apk/release/...` | Edit 11 |
`download-artifact`는 이 파일에 없다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` 끝에 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-TEST-APK.yaml
// ---------------------------------------------------------------------------------------------
const TEST_APK = "PROJECT-FLUTTER-ANDROID-TEST-APK.yaml";

test("TEST-APK: fastlane·Fastfile 분기 없이 flutter build apk --release를 직접 실행한다", () => {
  assertNoFastlane(TEST_APK);
  assert.deepStrictEqual(flutterBuildCommands(rawWorkflow(TEST_APK)), [`flutter build apk --release ${DART_DEFINE_FLAG}`]);
  assert.ok(!rawWorkflow(TEST_APK).includes("android/fastlane/Fastfile"));
});

test("TEST-APK: FLUTTER_PROJECT_DIR·ENV_MODE 토큰과 치환 결과", () => {
  assertWizardTokenLine(TEST_APK, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(TEST_APK, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(TEST_APK);
  assertRenderedEnvMode(TEST_APK);
});

test("TEST-APK: 환경변수 모드 — build-android-test에 Prepare env file", () => {
  assertLegacyEnvStepsRemoved(TEST_APK);
  assertEnvPreparedBeforeFlutterCommands(TEST_APK, ["build-android-test"]);
  assertEveryFlutterBuildUsesDartDefine(TEST_APK, 1);
  assert.ok(rawWorkflow(TEST_APK).includes(`printf '%s\\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"`));
});

test("TEST-APK: FLUTTER_PROJECT_DIR 정비 — 산출물·빌드정보·Firebase 경로가 Flutter 루트 기준이다", () => {
  assertJobsUseFlutterDir(TEST_APK, ["build-android-test"]);
  const text = rawWorkflow(TEST_APK);
  assert.ok(text.includes("      - name: Setup Gradle\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/*.apk\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-info.txt\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json\n"));
  assert.ok(text.includes("serviceCredentialsFile: ${{ env.FLUTTER_PROJECT_DIR }}/firebase-service-account.json"));
  assert.deepStrictEqual(rootRelativeStepPaths(TEST_APK), []);
  assertHashFilesScopedToFlutterRoot(TEST_APK);
  // version.yml을 읽는 prepare-test-build는 레포 루트에서 그대로 실행한다
  assert.ok(!jobBlocks(text).get("prepare-test-build").includes("FLUTTER_PROJECT_DIR"));
});

test("TEST-APK: 끊긴 웹 마법사 안내가 없고 필요한 Secrets 안내가 남는다", () => {
  assertNoBrokenWebWizardGuide(TEST_APK);
  assert.ok(rawWorkflow(TEST_APK).includes("RELEASE_KEYSTORE_BASE64"));
});

test("TEST-APK: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(TEST_APK);
  assertActionlintClean(TEST_APK);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: TEST-APK 케이스 5개 FAIL(fastlane 잔존·토큰·`Prepare env file`·경로·웹 마법사 문구), actionlint 케이스는 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-ANDROID-TEST-APK.yaml` 수정**

**Edit 1 — 헤더 — 끊긴 웹 마법사 안내 삭제**

앵커(기존 원문):

```yaml
# 🪄 빠른 설정: .github/util/flutter/firebase-wizard/firebase-wizard.html을
#    브라우저에서 열어 5단계 마법사로 Firebase 배포를 자동 설정할 수 있습니다.
```

교체 후:

```yaml
# ※ 위 Secrets는 저장소 Settings → Secrets and variables → Actions에 등록하세요.
#    Firebase 업로드를 쓰려면 아래 env의 FIREBASE_APP_ID·FIREBASE_TESTER_GROUP도 수정합니다.
```

**Edit 2 — env — FLUTTER_PROJECT_DIR·ENV_MODE 추가**

앵커(기존 원문):

```yaml
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:17
  ENV_FILE_PATH: ".env"
```

교체 후:

```yaml
  JAVA_VERSION: "__JAVA_VERSION__"  # @wizard ask:17
  # Flutter 루트 경로(레포 루트 기준). 단일레포면 ".", 모노레포면 "app" 등 — 설치 시 자동 설정
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  # dotenv 모드에서 .env를 만들 경로 (Flutter 루트 기준)
  ENV_FILE_PATH: ".env"
```

**Edit 3 — build-android-test defaults**

앵커(기존 원문):

```yaml
    name: Android 테스트 APK 빌드
    runs-on: ubuntu-latest
    needs: prepare-test-build
```

교체 후:

```yaml
    name: Android 테스트 APK 빌드
    runs-on: ubuntu-latest
    needs: prepare-test-build
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 4 — Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > ${{ env.ENV_FILE_PATH }}
          echo "✅ ${{ env.ENV_FILE_PATH }} file created"
```

교체 후:

```yaml
      # 환경변수 준비 — ENV_MODE=dotenv면 .env 파일, dart-define이면 프로젝트 밖 임시 파일(--dart-define-from-file)
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"
            echo "✅ $ENV_FILE_PATH file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 5 — Flutter pub 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 6 — Gradle 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/build.gradle', '**/gradle-wrapper.properties') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles(format('{0}/android/**/build.gradle', env.FLUTTER_PROJECT_DIR), format('{0}/android/**/gradle-wrapper.properties', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 7 — Setup Gradle 스텝 working-directory**

앵커(기존 원문):

```yaml
      - name: Setup Gradle
        working-directory: android
```

교체 후:

```yaml
      - name: Setup Gradle
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android
```

**Edit 8 — Ruby·Fastlane 설치 스텝 삭제**

앵커(기존 원문):

```yaml
      # Ruby 설정
      - name: Set up Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.4.1"
          bundler-cache: true

      - name: Verify Ruby version
        run: |
          echo "✅ Ruby setup completed"
          ruby -v

      # Fastlane 설치 (Bundler 방식 - gem 충돌 방지)
      - name: Install Fastlane
        working-directory: android
        run: |
          # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
          printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          bundle install
          echo "✅ Fastlane installed (Bundler)"
          bundle exec fastlane --version

```

교체: **삭제** (앵커 블록 전체를 지우고, 앞뒤 빈 줄이 한 줄만 남게 한다)

**Edit 9 — Build APK — Fastfile 분기 삭제, flutter 직접 빌드**

앵커(기존 원문):

```yaml
      # APK 빌드 (Fastlane 또는 직접 빌드)
      - name: Build APK
        run: |
          # Fastlane Fastfile이 있으면 사용, 없으면 직접 빌드
          if [ -f "android/fastlane/Fastfile" ]; then
            echo "📦 Fastlane을 사용하여 빌드..."
            cd android
            bundle exec fastlane build --verbose || flutter build apk --release
          else
            echo "📦 Flutter 직접 빌드..."
            flutter build apk --release
          fi
          ls -la ./build/app/outputs/flutter-apk/ || true
          echo "✅ APK built"
```

교체 후:

```yaml
      # APK 빌드 (flutter로 직접 빌드)
      - name: Build APK
        run: |
          echo "📦 Flutter 직접 빌드..."
          flutter build apk --release ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
          ls -la ./build/app/outputs/flutter-apk/ || true
          echo "✅ APK built"
```

**Edit 10 — Upload APK and build info 경로**

앵커(기존 원문):

```yaml
          path: |
            ./android/app/build/outputs/apk/release/*.apk
            build-info.txt
            build-metadata.json
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/*.apk
            ${{ env.FLUTTER_PROJECT_DIR }}/build-info.txt
            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json
```

**Edit 11 — Firebase 업로드 — 자격증명·APK 경로**

앵커(기존 원문):

```yaml
          serviceCredentialsFile: firebase-service-account.json
          groups: ${{ env.FIREBASE_TESTER_GROUP }}
          file: ./android/app/build/outputs/apk/release/${{ steps.apk_filename.outputs.apk_name }}
```

교체 후:

```yaml
          serviceCredentialsFile: ${{ env.FLUTTER_PROJECT_DIR }}/firebase-service-account.json
          groups: ${{ env.FIREBASE_TESTER_GROUP }}
          file: ${{ env.FLUTTER_PROJECT_DIR }}/android/app/build/outputs/apk/release/${{ steps.apk_filename.outputs.apk_name }}
```


수정 후 자체 점검:
```bash
grep -n -i "fastlane\|ruby\|Gemfile\|bundle \|util/flutter" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml   # 출력 없음
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-TEST-APK.yaml                                   # 1
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS (`TEST-APK: flutter pub get 직후 build_runner 조건부 코드 생성` 포함).

### Task 22: PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD — main push 앵커·환경변수 모드·배포 모드 폴백·ANDROID_PACKAGE_NAME·Gemfile C-lite

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (PLAYSTORE 케이스 추가)
- Modify: `tests/node/payload-example-values.test.js` (기존 테스트가 `fallback` 마커 줄을 오탐하지 않게 1줄 예외 — Step 3 참고)

**Interfaces:**
- 소비(D1, **선행 필수**): `src/core/wizard-env.js`의 `# @wizard fallback:<token>` 처리와 `makeResolvers`의 `android-deploy-mode`. 테스트는 resolvers를 직접 주입하지만 `substituteEnv`가 `fallback` 액션을 모르면 폴백 케이스가 실패한다.
- 워크플로우가 노출(D6 Fastfile `deploy_internal`이 읽는다): `AAB_PATH`, `GOOGLE_PLAY_JSON_KEY`, `VERSION_NAME`, `VERSION_CODE`, `DEPLOY_MODE`, **`PACKAGE_NAME`**(= `secrets.ANDROID_PACKAGE_NAME || vars.ANDROID_PACKAGE_NAME`, 업로드 스텝의 `env:`로 export). 변경 이력은 기존대로 `android/fastlane/metadata/android/ko-KR/changelogs/<VERSION_CODE>.txt`.
- 워크플로우가 노출: `env.ENV_MODE`, `env.DEPLOY_MODE`(마지막 폴백이 설치 시 선택값), `on.push.paths-anchor`.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- **배포 모드 폴백:** `DEPLOY_MODE` 줄 끝에 `# @wizard fallback:android-deploy-mode`를 붙인다. 표현식의 마지막 홑따옴표 리터럴만 바뀌므로 `workflow_dispatch` 입력·저장소 변수 `ANDROID_DEPLOY_MODE`가 항상 우선한다.
- **`ANDROID_PACKAGE_NAME`:** 업로드 스텝 `env:`에 `PACKAGE_NAME`으로 넘긴다(`secrets` 우선, 없으면 `vars`). 값이 비었을 때의 처리는 Fastfile(D6) 몫이라 워크플로우에 별도 가드를 넣지 않는다(이슈 제안 그대로).
- **Gemfile C-lite:** 스텝 이름 `Install Fastlane`, `working-directory: .../android`. 저장소 Gemfile에 `fastlane` 문자열이 있으면 그것으로 `bundle install`, 없으면 종전 `printf > Gemfile`(multi_json 우회 유지). 검사는 `grep -Eq "['\"]fastlane['\"]"`로 홑·겹따옴표 모두 받는다.
- **발견(수정 포함):** 이 파일의 `Upload project files`(`pubspec.yaml`, `lib/`, `assets/`)와 `Download project files`(`path: .`)는 워크스페이스 기준이라 `FLUTTER_PROJECT_DIR`가 `app`이면 업로드가 빈 목록이 되어 `if-no-files-found: error`로 job이 실패한다(이슈는 PLAYSTORE를 "정비됨"으로 봤지만 이 스텝은 빠져 있었다). main push 앵커를 붙여도 모노레포에서 못 도는 문제라 함께 고친다(Edit 7 · Edit 8). 다운로드는 `${{ env.FLUTTER_PROJECT_DIR }}`로 받는다(아티팩트 내부 구조의 LCA가 Flutter 루트이기 때문).
- `Prepare env file`은 `prepare-build`(`build_runner`가 dotenv 모드에서 `.env`를 읽음)와 `build-android` 두 곳. `deploy-playstore`는 빌드하지 않는다.
- `payload-example-values.test.js`의 "@wizard ask 마커의 대상 줄은 겹따옴표 값이어야 한다" 테스트는 `parseWizardLine`으로 모든 마커 줄을 순회한다. D1이 `MARKER_RE`에 `fallback`을 넣으면 `DEPLOY_MODE: ${{ ... }}` 줄(값이 따옴표가 아닌 표현식)이 오탐된다 — `p.action === "fallback"`이면 건너뛰도록 **1줄 예외**를 추가한다(이미 D1이 했다면 `grep -n 'fallback' tests/node/payload-example-values.test.js`로 확인하고 건너뛴다).

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 60·195·529 | job `defaults.run.working-directory` | 이미 정비됨 |
| 95·259 | `path: ~/.pub-cache` | 변경 없음 |
| 96·260 | `hashFiles('**/pubspec.lock')` | Edit 5 (2곳) |
| 109·137 | `working-directory: ${{ github.workspace }}` | 이미 레포 루트 기준 |
| 172 | `path: final_release_notes.txt` | 레포 루트 — 변경 없음 |
| 182–185 | project-files `path: \|` | Edit 7 |
| 212 | `download project-files path: .` | Edit 8 |
| 279–282 | gradle 캐시 `path`(`~/.gradle`)·`hashFiles('**/build.gradle*', ...)` | key만 Edit 6 |
| 519·550 | AAB `path: ${{ env.FLUTTER_PROJECT_DIR }}/build/...` | 이미 접두됨 |
| 557 | `download release-notes path: .` | 레포 루트 — 변경 없음 |
| 566 | `working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android` | 이미 접두됨 |

- [ ] **Step 0: 선행 조건 확인 (코드 수정 전)**

```bash
grep -n "fallback" src/core/wizard-env.js     # MARKER_RE가 (ask|auto|fallback) 이어야 한다. 없으면 D1 Task를 먼저 끝내고 돌아온다.
```

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` 끝에 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
// ---------------------------------------------------------------------------------------------
const PLAYSTORE = "PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml";
const GEMFILE_FASTLANE_CHECK = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
const GENERATED_GEMFILE = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;

test("PLAYSTORE: main push paths 앵커 — 모노레포에서 paths 필터로 치환된다", () => {
  assertPathsAnchor(PLAYSTORE);
});

test("PLAYSTORE: 환경변수 모드 — 빌드 job마다 Prepare env file, appbundle에 dart-define 플래그", () => {
  assertWizardTokenLine(PLAYSTORE, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedEnvMode(PLAYSTORE);
  assertLegacyEnvStepsRemoved(PLAYSTORE);
  assertEnvPreparedBeforeFlutterCommands(PLAYSTORE, ["prepare-build", "build-android"]);
  assertEveryFlutterBuildUsesDartDefine(PLAYSTORE, 1);
});

test("PLAYSTORE: 배포 모드 폴백 마커 — 설치 시 선택값이 표현식의 마지막 폴백 자리에 들어간다", () => {
  const marker = "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode";
  assertWizardTokenLine(PLAYSTORE, marker);
  const rendered = renderWorkflow(PLAYSTORE, { androidDeployMode: "store_prepare" });
  assert.match(rendered, /^  DEPLOY_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.ANDROID_DEPLOY_MODE \|\| 'store_prepare' \}\}\s*$/m);
  assert.ok(!rendered.includes("@wizard fallback"), "치환 후 마커 주석이 지워져야 합니다");
  // 선택값이 없으면(빈 문자열) 템플릿 기본값이 그대로 남는다
  assert.ok(renderWorkflow(PLAYSTORE, { androidDeployMode: "" }).includes("|| 'store_only' }}"));
});

test("PLAYSTORE: ANDROID_PACKAGE_NAME(secrets 우선, 없으면 vars)을 PACKAGE_NAME으로 fastlane 단계에 넘긴다", () => {
  const deploy = jobBlocks(rawWorkflow(PLAYSTORE)).get("deploy-playstore");
  assert.ok(deploy.includes("PACKAGE_NAME: ${{ secrets.ANDROID_PACKAGE_NAME || vars.ANDROID_PACKAGE_NAME }}"));
  assert.ok(deploy.indexOf("PACKAGE_NAME:") < deploy.indexOf("bundle exec fastlane deploy_internal"));
});

test("PLAYSTORE: Gemfile — 사용자 Gemfile에 fastlane이 있으면 그것을 쓰고, 없으면 multi_json 우회 Gemfile을 생성한다", () => {
  const text = rawWorkflow(PLAYSTORE);
  assert.ok(text.includes(GEMFILE_FASTLANE_CHECK), "fastlane 존재 확인 분기가 없습니다");
  assert.ok(text.includes(GENERATED_GEMFILE), "multi_json 우회 Gemfile 생성이 사라졌습니다");
  assert.ok(text.indexOf(GEMFILE_FASTLANE_CHECK) < text.indexOf(GENERATED_GEMFILE));
  assert.ok(text.indexOf(GENERATED_GEMFILE) < text.indexOf("bundle install"), "bundle install은 분기 뒤에 와야 합니다");
});

test("PLAYSTORE: 모노레포에서도 프로젝트 파일 아티팩트가 Flutter 루트 아래로 업·다운로드된다", () => {
  const text = rawWorkflow(PLAYSTORE);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml\n"));
  assert.ok(text.includes("          name: project-files\n          path: ${{ env.FLUTTER_PROJECT_DIR }}\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(PLAYSTORE), []);
  assertHashFilesScopedToFlutterRoot(PLAYSTORE);
});

test("PLAYSTORE: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(PLAYSTORE);
  assertActionlintClean(PLAYSTORE);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: PLAYSTORE 케이스 6개 FAIL(앵커·`Prepare env file`·폴백 마커·`PACKAGE_NAME`·Gemfile 분기·아티팩트 경로), actionlint 케이스는 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` 수정**

**Edit 1 — 헤더 — ANDROID_PACKAGE_NAME 안내**

앵커(기존 원문):

```yaml
# GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Play Console 서비스 계정 (base64)
```

교체 후:

```yaml
# GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Play Console 서비스 계정 (base64)
# ANDROID_PACKAGE_NAME: 앱 패키지명 (Secret 우선, 없으면 Variable) — fastlane에 PACKAGE_NAME으로 전달
```

**Edit 2 — on.push paths 앵커**

앵커(기존 원문):

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
  workflow_dispatch:
```

교체 후:

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
  workflow_dispatch:
```

**Edit 3 — env — ENV_MODE 추가 + DEPLOY_MODE 폴백 마커**

앵커(기존 원문):

```yaml
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 배포 모드 (store_only | store_prepare | store_submit)
  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}
```

교체 후:

```yaml
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  # 배포 모드 (store_only | store_prepare | store_submit) — 마지막 폴백값은 설치 시 선택값으로 설정, 변수·수동 입력이 항상 우선
  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.ANDROID_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:android-deploy-mode
```

**Edit 4 — prepare-build: Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > .env
          echo ".env file created"
```

교체 후:

```yaml
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > .env
            echo ".env file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 5 — Flutter pub 캐시 키 (2곳 전부)**

파일 안에서 아래 앵커가 **정확히 2곳** 동일하게 나온다. 모두 같은 내용으로 교체한다(`replace_all`). 교체 후 `grep -c` 로 2곳이 바뀌었는지 확인한다.

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 6 — Gradle 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles('**/build.gradle*', '**/gradle-wrapper.properties') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-gradle-${{ hashFiles(format('{0}/android/**/build.gradle*', env.FLUTTER_PROJECT_DIR), format('{0}/android/**/gradle-wrapper.properties', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 7 — Upload project files 경로 (모노레포에서 빈 업로드로 실패하던 문제)**

앵커(기존 원문):

```yaml
          path: |
            pubspec.yaml
            lib/
            assets/
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml
            ${{ env.FLUTTER_PROJECT_DIR }}/lib/
            ${{ env.FLUTTER_PROJECT_DIR }}/assets/
```

**Edit 8 — Download project files 경로**

앵커(기존 원문):

```yaml
          name: project-files
          path: .
```

교체 후:

```yaml
          name: project-files
          path: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 9 — build-android: Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      # .env 파일 생성 (보안을 위해 아티팩트가 아닌 시크릿에서 생성)
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > .env
          echo "✅ .env 파일 생성됨 (크기: $(wc -c < .env) bytes)"
```

교체 후:

```yaml
      # 환경변수 준비 (보안을 위해 아티팩트가 아닌 시크릿에서 생성) — ENV_MODE=dotenv면 .env 파일, dart-define이면 임시 파일
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > .env
            echo ".env file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 10 — flutter build appbundle**

앵커(기존 원문):

```yaml
            --build-number="$VERSION_CODE" \
            --verbose
```

교체 후:

```yaml
            --build-number="$VERSION_CODE" \
            --verbose \
            ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 11 — Install Fastlane — 사용자 Gemfile 우선(C-lite)**

앵커(기존 원문):

```yaml
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android
        run: |
          # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
          printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          bundle install
```

교체 후:

```yaml
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/android
        run: |
          # 저장소의 Gemfile에 fastlane이 있으면 그대로 쓴다 (Gemfile.lock 커밋 권장). 없으면 생성한다.
          if [ -f Gemfile ] && grep -Eq "['\"]fastlane['\"]" Gemfile; then
            echo "ℹ️ 저장소의 Gemfile을 사용합니다"
          else
            # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
            printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          fi
          bundle install
```

**Edit 12 — Play Store 업로드 스텝 — PACKAGE_NAME 전달**

앵커(기존 원문):

```yaml
      - name: Upload to Play Store Internal Testing
        env:
          DEPLOY_MODE: ${{ env.DEPLOY_MODE }}
```

교체 후:

```yaml
      - name: Upload to Play Store Internal Testing
        env:
          DEPLOY_MODE: ${{ env.DEPLOY_MODE }}
          PACKAGE_NAME: ${{ secrets.ANDROID_PACKAGE_NAME || vars.ANDROID_PACKAGE_NAME }}
```


이어서 `tests/node/payload-example-values.test.js`의 마커 순회 루프에 예외 1줄을 추가한다.

앵커(기존 원문):
```js
      const p = parseWizardLine(line);
      if (!p) return;
      if (!new RegExp(`^\\s*${p.key}:\\s*"`).test(line)) bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
```
교체 후:
```js
      const p = parseWizardLine(line);
      // fallback 마커 줄은 따옴표 값이 아니라 `${{ ... || 'literal' }}` 표현식이다 — 마지막 리터럴만 치환된다.
      if (!p || p.action === "fallback") return;
      if (!new RegExp(`^\\s*${p.key}:\\s*"`).test(line)) bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
```

수정 후 자체 점검:
```bash
grep -n "fallback:android-deploy-mode" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml   # 1줄
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml               # 2
grep -n "PACKAGE_NAME" payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml                    # 헤더 주석 + 업로드 스텝 env
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS. 특히 (a) `payload-yaml.test.js`의 PLAYSTORE 케이스 — `FLUTTER_PROJECT_DIR: "."` 정규식(`/^\s*FLUTTER_PROJECT_DIR:\s*"\."/m`)과 "upload-artifact 스텝 전부 `if-no-files-found: error`"(이번 수정은 `path`만 바꿨고 옵션은 그대로), (b) `payload-example-values.test.js` 마커 표기 케이스(위 1줄 예외 덕분에 통과), (c) `wizard-env.test.js`.

### Task 23: PROJECT-FLUTTER-IOS-TESTFLIGHT — main push 앵커·환경변수 모드·배포 모드 폴백·ExportOptions 검사·Gemfile C-lite·웹 마법사 안내 삭제

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (IOS-TESTFLIGHT 케이스 추가)

**Interfaces:**
- 소비(D1, 선행 필수): `# @wizard fallback:ios-deploy-mode` 처리(Step 0에서 확인).
- 소비(D6, 런타임 계약): `ios/ExportOptions.plist`의 플레이스홀더 `__TEAM_ID__`·`__BUNDLE_ID__`·`__PROVISIONING_PROFILE_NAME__`. 미치환 감지 정규식(셸) `grep -Eq '__[A-Z][A-Z0-9_]*__' <파일>`.
- 워크플로우가 노출(D6 Fastfile `deploy`가 읽는다, 기존과 동일): `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `API_KEY_PATH`, `IPA_PATH`, `RELEASE_NOTES`, `APP_IDENTIFIER`, `DEPLOY_MODE`, `APP_VERSION`, `BUILD_NUMBER`, `SKIP_WAITING_FOR_BUILD_PROCESSING`.
- 워크플로우가 노출: `env.ENV_MODE`, `env.DEPLOY_MODE`(마지막 폴백이 설치 시 선택값), `on.push.paths-anchor`.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- **미치환 검사 메시지에 플레이스홀더 리터럴을 쓰지 않는다.** 설치 후 검증 `scanUnsubstituted`(`src/core/verify.js`)는 **주석이 아닌** 줄에서 `__[A-Z][A-Z0-9_]*__`를 찾아 "미치환"으로 보고한다. 그래서 `echo "...__TEAM_ID__..."`처럼 쓰면 설치 요약이 오탐한다. 대신 `grep -En`으로 **남은 줄을 그대로 출력**하고, 안내는 "팀 ID·번들 ID·프로비저닝 프로파일 이름"으로 풀어 쓴다. `grep -Eq '__[A-Z]...'` 패턴 문자열 자체는 `__` 뒤가 `[`라 정규식에 걸리지 않는다(테스트 `assertNoUnsubstitutedPlaceholders`가 고정). 헤더의 주석은 검사 대상이 아니다.
- `Verify ExportOptions.plist`의 기존 `exit 1`(파일 없음) 분기는 손대지 않고, **그 뒤에** 잔존 검사를 추가한다(이슈 제안 범위 그대로).
- `.env`는 `project-files` 아티팩트에 싣지 않는다(PLAYSTORE 방식). 기존엔 `${{ env.ENV_FILE_PATH }}`를 실었지만 `build-ios`가 `Prepare env file`로 시크릿에서 다시 만든다(dart-define 모드에선 애초에 `.env`가 없음). `ENV_FILE_PATH`는 dotenv 분기의 경로 커스터마이징 지점으로 유지한다.
- `project-files`의 `path:`/`download path: .`는 워크스페이스 기준이라 `FLUTTER_PROJECT_DIR` 접두를 붙인다(모노레포에서 빈 업로드 실패 방지, Task 22와 같은 문제). 업로드 스텝의 `if-no-files-found: error`는 그대로 유지된다(기존 테스트가 고정).
- 헤더: 웹 마법사 소개(8~12행)와 "초기 설정 방법"의 웹 마법사 단계를 지우고, Secrets 등록 → `ios/ExportOptions.plist` 채우기 → push 순으로 3단계로 줄인다. 오류 echo는 `Verify Fastfile exists`의 웹 마법사 2줄을 Fastfile 커밋 + 상단 주석의 Secrets 안내로 바꾼다. Secrets 목록에 `IOS_BUNDLE_ID`를 추가하고 "`store_prepare`/`store_submit`을 쓰면 필수(비어 있으면 Fastfile이 명확한 오류로 중단)"라고 한 줄 덧붙인다(Task 26의 `require_env("APP_IDENTIFIER")` 분기와 짝).
- `flutter build ios`는 이 파일에 한 곳(줄 이음 `\`으로 3줄) — 마지막 `--build-number=...` 줄 끝에 ` \`를 붙이고 플래그를 새 줄로 둔다.

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 105·237·386 | job `defaults.run.working-directory` | 이미 정비됨 |
| 152·294 | `path: ~/.pub-cache` | 변경 없음 |
| 153·295 | `hashFiles('**/pubspec.lock')` | Edit 9 (2곳) |
| 176·189 | `working-directory: ${{ github.workspace }}` | 이미 레포 루트 기준 |
| 212 | `path: final_release_notes.txt` | 레포 루트 — 변경 없음 |
| 220–225 | project-files `path: \|` (`ENV_FILE_PATH`·Secrets.xcconfig·pubspec.yaml·lib·assets) | Edit 10 |
| 274 | `download project-files path: .` | Edit 11 |
| 374·405 | IPA `path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/...` | 이미 접두됨 |
| 411 | `download release-notes path: .` | 레포 루트 — 변경 없음 |
| 424 | `working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios` | 이미 접두됨 |

- [ ] **Step 0: 선행 조건 확인 (코드 수정 전)**

```bash
grep -n "fallback" src/core/wizard-env.js     # MARKER_RE가 (ask|auto|fallback) 이어야 한다. 없으면 D1 Task(와 Task 22 Step 0)를 먼저 끝내고 돌아온다.
```

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` 끝에 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml
// ---------------------------------------------------------------------------------------------
const IOS_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml";

test("IOS-TESTFLIGHT: main push paths 앵커 — 모노레포에서 paths 필터로 치환된다", () => {
  assertPathsAnchor(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: 환경변수 모드 — 빌드 job마다 Prepare env file, flutter build ios에 dart-define 플래그", () => {
  assertWizardTokenLine(IOS_TESTFLIGHT, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedEnvMode(IOS_TESTFLIGHT);
  assertLegacyEnvStepsRemoved(IOS_TESTFLIGHT);
  assertEnvPreparedBeforeFlutterCommands(IOS_TESTFLIGHT, ["prepare-build", "build-ios"]);
  assertEveryFlutterBuildUsesDartDefine(IOS_TESTFLIGHT, 1);
  // .env는 보안상 아티팩트에 싣지 않고 build-ios가 시크릿으로 다시 만든다
  const prepare = jobBlocks(rawWorkflow(IOS_TESTFLIGHT)).get("prepare-build");
  assert.ok(!prepare.includes("ENV_FILE_PATH }}\n            ios/Flutter"), "project-files 아티팩트에 .env가 실려서는 안 됩니다");
});

test("IOS-TESTFLIGHT: 배포 모드 폴백 마커 — 설치 시 선택값이 표현식의 마지막 폴백 자리에 들어간다", () => {
  assertWizardTokenLine(IOS_TESTFLIGHT, "  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:ios-deploy-mode");
  const rendered = renderWorkflow(IOS_TESTFLIGHT, { iosDeployMode: "store_submit" });
  assert.match(rendered, /^  DEPLOY_MODE: \$\{\{ github\.event\.inputs\.deploy_mode \|\| vars\.IOS_DEPLOY_MODE \|\| 'store_submit' \}\}\s*$/m);
  assert.ok(!rendered.includes("@wizard fallback"));
  assert.ok(renderWorkflow(IOS_TESTFLIGHT, { iosDeployMode: "" }).includes("|| 'store_only' }}"));
});

test("IOS-TESTFLIGHT: ExportOptions.plist 플레이스홀더가 남아 있으면 명확한 메시지로 중단한다", () => {
  const verify = rawWorkflow(IOS_TESTFLIGHT).match(/- name: Verify ExportOptions\.plist\n[\s\S]*?(?=\n      - name: )/)[0];
  assert.ok(verify.includes("grep -Eq '__[A-Z][A-Z0-9_]*__' ExportOptions.plist"));
  assert.ok(verify.includes("채워지지 않은 플레이스홀더"));
  assert.ok(verify.includes("exit 1"));
  // 워크플로우 본문에 __TOKEN__ 리터럴이 실행 줄로 남으면 설치 후 검증(scanUnsubstituted)이 '미치환'으로 오탐한다
  assertNoUnsubstitutedPlaceholders(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: Gemfile — 사용자 Gemfile에 fastlane이 있으면 그것을 쓰고, 없으면 multi_json 우회 Gemfile을 생성한다", () => {
  const text = rawWorkflow(IOS_TESTFLIGHT);
  const check = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
  const generated = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;
  assert.ok(text.includes(check));
  assert.ok(text.includes(generated));
  assert.ok(text.indexOf(check) < text.indexOf(generated));
  assert.ok(text.indexOf(generated) < text.indexOf("bundle install\n          echo \"✅ Fastlane installed"));
});

test("IOS-TESTFLIGHT: 프로젝트 파일 아티팩트가 Flutter 루트 아래로 업·다운로드된다", () => {
  const text = rawWorkflow(IOS_TESTFLIGHT);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/ios/Flutter/Secrets.xcconfig\n"));
  assert.ok(text.includes("          name: project-files\n          path: ${{ env.FLUTTER_PROJECT_DIR }}\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(IOS_TESTFLIGHT), []);
  assertHashFilesScopedToFlutterRoot(IOS_TESTFLIGHT);
});

test("IOS-TESTFLIGHT: 끊긴 웹 마법사 안내가 없고 필요한 Secrets 안내가 남는다", () => {
  assertNoBrokenWebWizardGuide(IOS_TESTFLIGHT);
  const text = rawWorkflow(IOS_TESTFLIGHT);
  for (const secret of ["APPLE_CERTIFICATE_BASE64", "APP_STORE_CONNECT_API_KEY_BASE64", "IOS_PROVISIONING_PROFILE_NAME"]) {
    assert.ok(text.includes(secret), secret);
  }
});

test("IOS-TESTFLIGHT: actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertActionlintClean(IOS_TESTFLIGHT);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: IOS-TESTFLIGHT 케이스 7개 FAIL(앵커·`Prepare env file`·폴백 마커·plist 검사·Gemfile·아티팩트 경로·웹 마법사 문구), actionlint 케이스는 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` 수정**

**Edit 1 — 헤더 — 웹 마법사 소개 삭제**

앵커(기존 원문):

```yaml
# ★ 마법사 우선 아키텍처 ★
# - 빌드에 필요한 설정 파일들은 웹 마법사가 생성합니다
# - 워크플로우는 마법사가 생성한 파일들을 그대로 사용합니다
# - 마법사 경로: .github/util/flutter/ios-testflight-setup-wizard/index.html
#   (브라우저에서 열어서 사용)
#
```

교체 후:

```yaml
# 설정 파일(ios/fastlane/Fastfile, ios/ExportOptions.plist)은 project-auto-wizard가
# 없을 때만 설치하며, 이미 있으면 덮어쓰지 않습니다.
#
```

**Edit 2 — 헤더 — fastlane 설명**

앵커(기존 원문):

```yaml
#   4. fastlane deploy (마법사 생성 Fastfile 사용, DEPLOY_MODE에 따라 TestFlight/심사 제출)
```

교체 후:

```yaml
#   4. fastlane deploy (ios/fastlane/Fastfile 사용, DEPLOY_MODE에 따라 TestFlight/심사 제출)
```

**Edit 3 — 헤더 — 초기 설정 방법 재작성**

앵커(기존 원문):

```yaml
# 🛠️ 초기 설정 방법
# ===================================================================
#
# 1. 웹 마법사 실행:
#    브라우저에서 .github/util/flutter/ios-testflight-setup-wizard/index.html 열기
#    → 필요한 정보 입력 후 설정 파일 다운로드
#
# 2. GitHub Secrets 설정 (위 목록 참고)
#
# 3. 생성된 파일 커밋:
#    git add ios/
#    git commit -m "chore: iOS TestFlight 배포 설정"
#
# 4. {{MAIN_BRANCH}} 브랜치로 푸시하여 배포 시작
```

교체 후:

```yaml
# 🛠️ 초기 설정 방법
# ===================================================================
#
# 1. GitHub Secrets 설정 (위 목록 참고)
#
# 2. ios/ExportOptions.plist의 플레이스홀더(팀 ID·번들 ID·프로비저닝 프로파일 이름)를 채워 커밋:
#    git add ios/
#    git commit -m "chore: iOS TestFlight 배포 설정"
#
# 3. {{MAIN_BRANCH}} 브랜치로 푸시하여 배포 시작
```

**Edit 4 — on.push paths 앵커**

앵커(기존 원문):

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
  workflow_dispatch:
```

교체 후:

```yaml
  push:
    branches: ["{{MAIN_BRANCH}}"]
    # @wizard paths-anchor (모노레포일 때 integrator가 paths 필터를 여기 주입)
  workflow_dispatch:
```

**Edit 5 — env — ENV_MODE 추가**

앵커(기존 원문):

```yaml
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  FLUTTER_VERSION: "3.35.5"
```

교체 후:

```yaml
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  FLUTTER_VERSION: "3.35.5"
```

**Edit 6 — ENV_FILE_PATH 주석**

앵커(기존 원문):

```yaml
  # .env 파일 생성 경로 (프로젝트 루트 기준)
```

교체 후:

```yaml
  # dotenv 모드에서 .env 파일을 만들 경로 (Flutter 루트 기준)
```

**Edit 7 — DEPLOY_MODE 폴백 마커**

앵커(기존 원문):

```yaml
  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}
```

교체 후:

```yaml
  DEPLOY_MODE: ${{ github.event.inputs.deploy_mode || vars.IOS_DEPLOY_MODE || 'store_only' }}  # @wizard fallback:ios-deploy-mode
```

**Edit 8 — prepare-build: Create .env file → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Create .env file
        run: |
          cat << 'EOF' > ${{ env.ENV_FILE_PATH }}
          ${{ secrets.ENV_FILE || secrets.ENV }}
          EOF
          echo "✅ ${{ env.ENV_FILE_PATH }} file created"
```

교체 후:

```yaml
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"
            echo "✅ $ENV_FILE_PATH file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 9 — Flutter pub 캐시 키 (2곳 전부)**

파일 안에서 아래 앵커가 **정확히 2곳** 동일하게 나온다. 모두 같은 내용으로 교체한다(`replace_all`). 교체 후 `grep -c` 로 2곳이 바뀌었는지 확인한다.

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 10 — Upload project files 경로 (.env는 아티팩트에서 제외 — build-ios가 시크릿으로 재생성)**

앵커(기존 원문):

```yaml
          path: |
            ${{ env.ENV_FILE_PATH }}
            ios/Flutter/Secrets.xcconfig
            pubspec.yaml
            lib/
            assets/
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/ios/Flutter/Secrets.xcconfig
            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml
            ${{ env.FLUTTER_PROJECT_DIR }}/lib/
            ${{ env.FLUTTER_PROJECT_DIR }}/assets/
```

**Edit 11 — Download project files 경로**

앵커(기존 원문):

```yaml
          name: project-files
          path: .
```

교체 후:

```yaml
          name: project-files
          path: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 12 — build-ios: Ensure .env file exists → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Ensure .env file exists
        run: |
          if [ ! -f "${{ env.ENV_FILE_PATH }}" ]; then
            cat << 'EOF' > ${{ env.ENV_FILE_PATH }}
          ${{ secrets.ENV_FILE || secrets.ENV }}
          EOF
            echo "✅ ${{ env.ENV_FILE_PATH }} file created (fallback)"
          fi
```

교체 후:

```yaml
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"
            echo "✅ $ENV_FILE_PATH file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 13 — Verify ExportOptions.plist — 플레이스홀더 잔존 검사**

앵커(기존 원문):

```yaml
          cd ios
          if [ ! -f "ExportOptions.plist" ]; then
            exit 1
          fi
```

교체 후:

```yaml
          cd ios
          if [ ! -f "ExportOptions.plist" ]; then
            exit 1
          fi
          # 설치기가 만든 템플릿의 플레이스홀더를 채우지 않으면 xcodebuild가 이해하기 어려운 오류로 끝난다
          if grep -Eq '__[A-Z][A-Z0-9_]*__' ExportOptions.plist; then
            echo "❌ ios/ExportOptions.plist에 채워지지 않은 플레이스홀더가 남아 있습니다:"
            grep -En '__[A-Z][A-Z0-9_]*__' ExportOptions.plist
            echo "팀 ID·번들 ID·프로비저닝 프로파일 이름으로 바꿔 커밋한 뒤 다시 실행하세요."
            exit 1
          fi
```

**Edit 14 — flutter build ios**

앵커(기존 원문):

```yaml
            --build-number="${{ needs.prepare-build.outputs.build_number }}"
```

교체 후:

```yaml
            --build-number="${{ needs.prepare-build.outputs.build_number }}" \
            ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 15 — 섹션 주석**

앵커(기존 원문):

```yaml
  # TestFlight 배포 (마법사 생성 Fastfile 사용)
```

교체 후:

```yaml
  # TestFlight 배포 (ios/fastlane/Fastfile 사용)
```

**Edit 16 — Verify Fastfile exists — 웹 마법사 안내 삭제**

앵커(기존 원문):

```yaml
            echo "❌ ios/fastlane/Fastfile이 없습니다!"
            echo "웹 마법사를 실행하여 설정 파일을 생성하세요:"
            echo "  브라우저에서 .github/util/flutter/ios-testflight-setup-wizard/index.html 열기"
            exit 1
```

교체 후:

```yaml
            echo "❌ ios/fastlane/Fastfile이 없습니다!"
            echo "ios/fastlane/Fastfile을 저장소에 추가(커밋)하세요. 필요한 Secrets는 워크플로우 상단 주석을 참고하세요."
            exit 1
```

**Edit 17 — Install Fastlane — 사용자 Gemfile 우선(C-lite)**

앵커(기존 원문):

```yaml
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios
        run: |
          # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
          printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          bundle install
```

교체 후:

```yaml
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios
        run: |
          # 저장소의 Gemfile에 fastlane이 있으면 그대로 쓴다 (Gemfile.lock 커밋 권장). 없으면 생성한다.
          if [ -f Gemfile ] && grep -Eq "['\"]fastlane['\"]" Gemfile; then
            echo "ℹ️ 저장소의 Gemfile을 사용합니다"
          else
            # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
            printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          fi
          bundle install
```


수정 후 자체 점검:
```bash
grep -n "util/flutter\|웹 마법사" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml      # 출력 없음
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml             # 2
grep -n "fallback:ios-deploy-mode" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml     # 1줄
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전부 PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS (`PROJECT-FLUTTER-IOS-TESTFLIGHT: FLUTTER_ROOT가 FLUTTER_PROJECT_DIR로 개명`·`upload-artifact 스텝 전부 if-no-files-found: error`·`flutter pub get 직후 build_runner` 포함).

### Task 24: PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT — FLUTTER_PROJECT_DIR 정비·환경변수 모드·Gemfile C-lite·웹 마법사 안내 삭제

**Files:**
- Modify: `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`
- Modify: `tests/node/flutter-workflows-payload.test.js` (IOS-TEST-TESTFLIGHT 케이스 추가)

**Interfaces:**
- 소비: Task 18 헬퍼. 소비(D1): `auto:flutter-root`, `auto:flutter-env-mode`. (`workflow_dispatch`/`repository_dispatch` 전용 — main push 앵커·배포 모드 폴백 없음.)
- 소비(D6, 런타임): `ios/fastlane/Fastfile`의 `upload_testflight` lane이 읽는 `API_KEY_PATH`, `IPA_PATH`, `RELEASE_NOTES`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` — 기존 export 그대로(`APP_IDENTIFIER`는 오지 않을 수 있음, 워크플로우 수정 없음).
- 워크플로우가 노출: `env.FLUTTER_PROJECT_DIR`, `env.ENV_MODE`.

> 이 Task는 다른 Task의 결과물을 만들지 않는다. 앞선 Task(D1의 `substituteEnv` `fallback` 액션·`makeResolvers` 토큰 4종)를 **소비만** 한다.
> 모든 앵커는 `payload/workflows/flutter/<파일>`의 **현재 원문**이다. `Edit` 도구의 `old_string`으로 그대로 쓰고, 유일성 실패 시 앵커가 중복된 것이므로 위 설명의 `replace_all` 지시를 따른다.


**설계 결정:**
- `prepare-test-build`(macOS): 이 job은 빌드하지 않는다(`flutter pub get`도 없음). 다만 `Secrets.xcconfig`를 만들고 project-files를 올리므로 `defaults`를 걸고, `version_manager.py`·릴리즈 노트 스텝은 레포 루트 기준이라 `working-directory: ${{ github.workspace }}`를 붙인다(`final_release_notes.txt`는 루트에서 만들어 루트에서 업로드).
- `prepare-test-build`의 **`Create .env file` 스텝을 삭제**한다. 종전엔 이 스텝이 만든 `.env`를 아티팩트에 실었고 `build-ios-test`가 없을 때만 다시 만들었다(`Ensure .env file exists`). 이제 `build-ios-test`가 `Prepare env file`로 항상 시크릿에서 만들므로 준비 job에서 시크릿 파일을 만들거나 아티팩트에 싣지 않는다.
- `build-ios-test`: `defaults` + `Ensure .env file exists` → `Prepare env file` + `flutter build ios` 플래그 + IPA/`build-metadata.json` 업로드 경로 접두. `Create build metadata file`은 cwd(Flutter 루트)에 쓰므로 업로드 경로에 접두를 붙이면 종전 아티팩트 구조(`ios/build/ipa/*.ipa`, `build-metadata.json`)가 그대로다.
- `deploy-testflight-test`: `defaults` + IPA 내려받기 경로 접두 + `Install Fastlane` `working-directory` 접두 + 업로드 스텝의 IPA `find`를 `$GITHUB_WORKSPACE/${FLUTTER_PROJECT_DIR}/ios/build/ipa`로, `final_release_notes.txt`를 `$GITHUB_WORKSPACE/`로(`run:`의 cwd가 Flutter 루트로 바뀌므로). `Download release notes path: .`은 레포 루트에 내려받으므로 그대로.
- 이 파일에도 `Verify ExportOptions.plist`가 있지만 이슈는 플레이스홀더 검사를 `IOS-TESTFLIGHT`에만 요구한다 — 여기서는 웹 마법사 안내 2줄만 지운다(같은 검사를 붙일지는 후속 판단으로 남기고 최종 보고에 적는다).

**FLUTTER_PROJECT_DIR 전수 조사(원본 라인 기준):**
`grep -nE "^\s+(- )?(path|file|serviceCredentialsFile|working-directory|key|releaseNotesFile):|hashFiles" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml`
| 라인 | 내용 | 처리 |
|---|---|---|
| 353 | `path: final_release_notes.txt` | 레포 루트 — 변경 없음 |
| 360–365 | project-files `path: \|` (`ENV_FILE_PATH`·Secrets.xcconfig·pubspec.yaml·lib·assets) | Edit 8 |
| 520 | `download project-files path: .` | Edit 10 |
| 540 | `path: ~/.pub-cache` | 변경 없음 |
| 541 | `hashFiles('**/pubspec.lock')` | Edit 12 |
| 638–640 | IPA `path: \|` (`ios/build/ipa/*.ipa`, `build-metadata.json`) | Edit 15 |
| 787 | `download ios-ipa path: ios/build/ipa/` | Edit 18 |
| 793 | `download release-notes path: .` | 레포 루트 — 변경 없음 |
| 806 | `working-directory: ios` (Install Fastlane) | Edit 20 |
`run:` 안의 `cd ios`, `find $GITHUB_WORKSPACE/ios/build/ipa`, `ls -la ios/build/ipa/`, `final_release_notes.txt`는 위 설계 결정대로 `defaults`(cwd = Flutter 루트) 기준으로 다시 맞춘다(Edit 21 · Edit 22).

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/node/flutter-workflows-payload.test.js` 끝에 이어 붙인다.

```js
// ---------------------------------------------------------------------------------------------
// PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml
// ---------------------------------------------------------------------------------------------
const IOS_TEST_TESTFLIGHT = "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml";

test("IOS-TEST-TESTFLIGHT: FLUTTER_PROJECT_DIR·ENV_MODE 토큰과 치환 결과", () => {
  assertWizardTokenLine(IOS_TEST_TESTFLIGHT, '  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root');
  assertWizardTokenLine(IOS_TEST_TESTFLIGHT, '  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode');
  assertRenderedFlutterRoot(IOS_TEST_TESTFLIGHT);
  assertRenderedEnvMode(IOS_TEST_TESTFLIGHT);
});

test("IOS-TEST-TESTFLIGHT: 환경변수 모드 — flutter build를 하는 build-ios-test에만 Prepare env file", () => {
  assertLegacyEnvStepsRemoved(IOS_TEST_TESTFLIGHT);
  assertEnvPreparedBeforeFlutterCommands(IOS_TEST_TESTFLIGHT, ["build-ios-test"]);
  assertEveryFlutterBuildUsesDartDefine(IOS_TEST_TESTFLIGHT, 1);
  // 준비 job은 빌드하지 않는다 — .env를 아티팩트에 싣지 않는다
  const prepare = jobBlocks(rawWorkflow(IOS_TEST_TESTFLIGHT)).get("prepare-test-build");
  assert.ok(!prepare.includes("ENV_FILE_PATH"));
});

test("IOS-TEST-TESTFLIGHT: FLUTTER_PROJECT_DIR 정비 — job 기본 경로·워크스페이스 기준 스텝·아티팩트 경로", () => {
  assertJobsUseFlutterDir(IOS_TEST_TESTFLIGHT, ["prepare-test-build", "build-ios-test", "deploy-testflight-test"]);
  const blocks = jobBlocks(rawWorkflow(IOS_TEST_TESTFLIGHT));
  const prepare = blocks.get("prepare-test-build");
  assert.match(prepare, /name: 테스트 빌드 버전 설정\n        id: test_version\n        working-directory: \$\{\{ github\.workspace \}\}/);
  assert.match(prepare, /name: 릴리즈 노트 생성\n        id: release_notes\n        working-directory: \$\{\{ github\.workspace \}\}/);
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/*.ipa\n"));
  assert.ok(text.includes("            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json\n"));
  assert.ok(text.includes("          name: ios-ipa\n          path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/\n"));
  assert.ok(text.includes('find "$GITHUB_WORKSPACE/${FLUTTER_PROJECT_DIR}/ios/build/ipa"'));
  assert.ok(text.includes('if [ -f "$GITHUB_WORKSPACE/final_release_notes.txt" ]'));
  assert.ok(text.includes("      - name: Install Fastlane\n        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios\n"));
  assert.deepStrictEqual(rootRelativeStepPaths(IOS_TEST_TESTFLIGHT), []);
  assertHashFilesScopedToFlutterRoot(IOS_TEST_TESTFLIGHT);
});

test("IOS-TEST-TESTFLIGHT: Gemfile — 사용자 Gemfile에 fastlane이 있으면 그것을 쓰고, 없으면 multi_json 우회 Gemfile을 생성한다", () => {
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  const check = `if [ -f Gemfile ] && grep -Eq "['\\"]fastlane['\\"]" Gemfile; then`;
  const generated = `printf 'source "https://rubygems.org"\\ngem "fastlane"\\ngem "multi_json"\\n' > Gemfile`;
  assert.ok(text.includes(check));
  assert.ok(text.includes(generated));
  assert.ok(text.indexOf(check) < text.indexOf(generated));
});

test("IOS-TEST-TESTFLIGHT: 끊긴 웹 마법사 안내가 없고 필요한 Secrets 안내가 남는다", () => {
  assertNoBrokenWebWizardGuide(IOS_TEST_TESTFLIGHT);
  const text = rawWorkflow(IOS_TEST_TESTFLIGHT);
  for (const secret of ["APPLE_CERTIFICATE_BASE64", "APP_STORE_CONNECT_API_KEY_BASE64", "IOS_PROVISIONING_PROFILE_NAME"]) {
    assert.ok(text.includes(secret), secret);
  }
});

test("IOS-TEST-TESTFLIGHT: 치환 후 미치환 토큰이 없고 actionlint 신규 경고가 없다", { skip: !HAS_ACTIONLINT && "actionlint 없음" }, () => {
  assertNoUnsubstitutedPlaceholders(IOS_TEST_TESTFLIGHT);
  assertActionlintClean(IOS_TEST_TESTFLIGHT);
});
```


- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: IOS-TEST-TESTFLIGHT 케이스 5개 FAIL(토큰·`Prepare env file`·`defaults`·Gemfile·웹 마법사 문구), actionlint 케이스는 PASS.

- [ ] **Step 3: `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml` 수정**

**Edit 1 — 헤더 — 웹 마법사 소개 삭제**

앵커(기존 원문):

```yaml
# ★ 마법사 우선 아키텍처 ★
# - 빌드에 필요한 설정 파일들은 웹 마법사가 생성합니다
# - 워크플로우는 마법사가 생성한 파일들을 그대로 사용합니다
# - 마법사 경로: .github/util/flutter/ios-testflight-setup-wizard/index.html
#
```

교체 후:

```yaml
# 설정 파일(ios/fastlane/Fastfile, ios/ExportOptions.plist)은 project-auto-wizard가
# 없을 때만 설치하며, 이미 있으면 덮어쓰지 않습니다.
#
```

**Edit 2 — 헤더 — fastlane 설명**

앵커(기존 원문):

```yaml
#   4. fastlane upload_testflight (마법사 생성 Fastfile 사용)
```

교체 후:

```yaml
#   4. fastlane upload_testflight (ios/fastlane/Fastfile 사용)
```

**Edit 3 — env — FLUTTER_PROJECT_DIR·ENV_MODE 추가**

앵커(기존 원문):

```yaml
  PROJECT_TYPE: "flutter"
  ENV_FILE_PATH: ".env"
```

교체 후:

```yaml
  PROJECT_TYPE: "flutter"
  # Flutter 루트 경로(레포 루트 기준). 단일레포면 ".", 모노레포면 "app" 등 — 설치 시 자동 설정
  FLUTTER_PROJECT_DIR: "."  # @wizard auto:flutter-root
  # 환경변수 전달 방식 (dart-define | dotenv) — 설치 시 선택값으로 자동 설정
  ENV_MODE: "dart-define"  # @wizard auto:flutter-env-mode
  # dotenv 모드에서 .env 파일을 만들 경로 (Flutter 루트 기준)
  ENV_FILE_PATH: ".env"
```

**Edit 4 — prepare-test-build defaults**

앵커(기존 원문):

```yaml
  prepare-test-build:
    name: 테스트 빌드 준비
    runs-on: macos-26
    needs: notify-start
```

교체 후:

```yaml
  prepare-test-build:
    name: 테스트 빌드 준비
    runs-on: macos-26
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
    needs: notify-start
```

**Edit 5 — prepare-test-build: .env 생성 스텝 삭제 (build-ios-test가 시크릿으로 만든다)**

앵커(기존 원문):

```yaml
      - name: Create .env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          printf '%s\n' "$ENV_CONTENT" > ${{ env.ENV_FILE_PATH }}
          echo "✅ ${{ env.ENV_FILE_PATH }} file created"

```

교체: **삭제** (앵커 블록 전체를 지우고, 앞뒤 빈 줄이 한 줄만 남게 한다)

**Edit 6 — 테스트 빌드 버전 스텝 — 레포 루트에서 실행**

앵커(기존 원문):

```yaml
      - name: 테스트 빌드 버전 설정
        id: test_version
        run: |
```

교체 후:

```yaml
      - name: 테스트 빌드 버전 설정
        id: test_version
        working-directory: ${{ github.workspace }}   # version_manager.py가 레포 루트 version.yml을 읽어야 함
        run: |
```

**Edit 7 — 릴리즈 노트 스텝 — 레포 루트에서 실행**

앵커(기존 원문):

```yaml
      - name: 릴리즈 노트 생성
        id: release_notes
        run: |
```

교체 후:

```yaml
      - name: 릴리즈 노트 생성
        id: release_notes
        working-directory: ${{ github.workspace }}   # final_release_notes.txt(upload 짝)는 레포 루트 기준
        run: |
```

**Edit 8 — Upload project files 경로 (.env는 아티팩트에서 제외)**

앵커(기존 원문):

```yaml
          path: |
            ${{ env.ENV_FILE_PATH }}
            ios/Flutter/Secrets.xcconfig
            pubspec.yaml
            lib/
            assets/
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/ios/Flutter/Secrets.xcconfig
            ${{ env.FLUTTER_PROJECT_DIR }}/pubspec.yaml
            ${{ env.FLUTTER_PROJECT_DIR }}/lib/
            ${{ env.FLUTTER_PROJECT_DIR }}/assets/
```

**Edit 9 — build-ios-test defaults**

앵커(기존 원문):

```yaml
  build-ios-test:
    name: iOS 테스트 빌드
    runs-on: macos-26
```

교체 후:

```yaml
  build-ios-test:
    name: iOS 테스트 빌드
    runs-on: macos-26
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 10 — Download project files 경로**

앵커(기존 원문):

```yaml
          name: project-files
          path: .
```

교체 후:

```yaml
          name: project-files
          path: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 11 — Ensure .env file exists → Prepare env file**

앵커(기존 원문):

```yaml
      - name: Ensure .env file exists
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ ! -f "${{ env.ENV_FILE_PATH }}" ]; then
            printf '%s\n' "$ENV_CONTENT" > ${{ env.ENV_FILE_PATH }}
            echo "✅ ${{ env.ENV_FILE_PATH }} file created (fallback)"
          fi
```

교체 후:

```yaml
      - name: Prepare env file
        env:
          ENV_CONTENT: ${{ secrets.ENV_FILE || secrets.ENV }}
        run: |
          if [ "$ENV_MODE" = "dotenv" ]; then
            printf '%s\n' "$ENV_CONTENT" > "$ENV_FILE_PATH"
            echo "✅ $ENV_FILE_PATH file created"
          elif [ -n "$ENV_CONTENT" ]; then
            DART_DEFINE_FILE="$RUNNER_TEMP/dart-define.env"
            printf '%s\n' "$ENV_CONTENT" > "$DART_DEFINE_FILE"
            echo "DART_DEFINE_FILE=$DART_DEFINE_FILE" >> "$GITHUB_ENV"
            echo "dart-define file prepared"
          fi
```

**Edit 12 — Flutter pub 캐시 키**

앵커(기존 원문):

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles('**/pubspec.lock') }}
```

교체 후:

```yaml
          key: ${{ runner.os }}-flutter-pub-${{ hashFiles(format('{0}/**/pubspec.lock', env.FLUTTER_PROJECT_DIR)) }}
```

**Edit 13 — Verify ExportOptions.plist — 웹 마법사 안내 삭제**

앵커(기존 원문):

```yaml
            echo "❌ ios/ExportOptions.plist이 없습니다!"
            echo "웹 마법사를 실행하여 설정 파일을 생성하세요:"
            echo "  브라우저에서 .github/util/flutter/ios-testflight-setup-wizard/index.html 열기"
            exit 1
```

교체 후:

```yaml
            echo "❌ ios/ExportOptions.plist가 없습니다!"
            echo "ios/ExportOptions.plist를 저장소에 추가(커밋)하세요. 필요한 Secrets는 워크플로우 상단 주석을 참고하세요."
            exit 1
```

**Edit 14 — flutter build ios**

앵커(기존 원문):

```yaml
            --build-number="${{ needs.prepare-test-build.outputs.build_number }}"
```

교체 후:

```yaml
            --build-number="${{ needs.prepare-test-build.outputs.build_number }}" \
            ${DART_DEFINE_FILE:+--dart-define-from-file="$DART_DEFINE_FILE"}
```

**Edit 15 — Upload IPA artifact 경로**

앵커(기존 원문):

```yaml
          path: |
            ios/build/ipa/*.ipa
            build-metadata.json
```

교체 후:

```yaml
          path: |
            ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/*.ipa
            ${{ env.FLUTTER_PROJECT_DIR }}/build-metadata.json
```

**Edit 16 — 섹션 주석**

앵커(기존 원문):

```yaml
  # TestFlight 배포 (마법사 생성 Fastfile 사용)
```

교체 후:

```yaml
  # TestFlight 배포 (ios/fastlane/Fastfile 사용)
```

**Edit 17 — deploy-testflight-test defaults**

앵커(기존 원문):

```yaml
    name: TestFlight 테스트 배포
    runs-on: macos-26
```

교체 후:

```yaml
    name: TestFlight 테스트 배포
    runs-on: macos-26
    defaults:
      run:
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}
```

**Edit 18 — Download IPA artifact 경로**

앵커(기존 원문):

```yaml
          name: ios-ipa
          path: ios/build/ipa/
```

교체 후:

```yaml
          name: ios-ipa
          path: ${{ env.FLUTTER_PROJECT_DIR }}/ios/build/ipa/
```

**Edit 19 — Verify Fastfile exists — 웹 마법사 안내 삭제**

앵커(기존 원문):

```yaml
            echo "❌ ios/fastlane/Fastfile이 없습니다!"
            echo "웹 마법사를 실행하여 설정 파일을 생성하세요:"
            echo "  브라우저에서 .github/util/flutter/ios-testflight-setup-wizard/index.html 열기"
            exit 1
```

교체 후:

```yaml
            echo "❌ ios/fastlane/Fastfile이 없습니다!"
            echo "ios/fastlane/Fastfile을 저장소에 추가(커밋)하세요. 필요한 Secrets는 워크플로우 상단 주석을 참고하세요."
            exit 1
```

**Edit 20 — Install Fastlane — 사용자 Gemfile 우선(C-lite)**

앵커(기존 원문):

```yaml
        working-directory: ios
        run: |
          # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
          printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          bundle install
```

교체 후:

```yaml
        working-directory: ${{ env.FLUTTER_PROJECT_DIR }}/ios
        run: |
          # 저장소의 Gemfile에 fastlane이 있으면 그대로 쓴다 (Gemfile.lock 커밋 권장). 없으면 생성한다.
          if [ -f Gemfile ] && grep -Eq "['\"]fastlane['\"]" Gemfile; then
            echo "ℹ️ 저장소의 Gemfile을 사용합니다"
          else
            # multi_json: google-apis transitive 의존성이 선언 누락한 upstream 버그 회피 (gemspec 미선언 → Gem::LoadError)
            printf 'source "https://rubygems.org"\ngem "fastlane"\ngem "multi_json"\n' > Gemfile
          fi
          bundle install
```

**Edit 21 — Upload to TestFlight — IPA·릴리즈 노트 경로**

앵커(기존 원문):

```yaml
          IPA_PATH=$(find $GITHUB_WORKSPACE/ios/build/ipa -name "*.ipa" | head -1)
```

교체 후:

```yaml
          IPA_PATH=$(find "$GITHUB_WORKSPACE/${FLUTTER_PROJECT_DIR}/ios/build/ipa" -name "*.ipa" | head -1)
```

**Edit 22 — Upload to TestFlight — final_release_notes.txt는 레포 루트 기준**

앵커(기존 원문):

```yaml
          # Release notes 준비
          if [ -f "final_release_notes.txt" ]; then
            RELEASE_NOTES=$(cat final_release_notes.txt)
```

교체 후:

```yaml
          # Release notes 준비 (final_release_notes.txt는 레포 루트 기준 — working-directory가 FLUTTER_PROJECT_DIR이므로 절대경로 사용)
          if [ -f "$GITHUB_WORKSPACE/final_release_notes.txt" ]; then
            RELEASE_NOTES=$(cat "$GITHUB_WORKSPACE/final_release_notes.txt")
```

**Edit 23 — Fastlane 실행 주석**

앵커(기존 원문):

```yaml
          # Fastlane 실행 (마법사가 생성한 Fastfile 사용)
```

교체 후:

```yaml
          # Fastlane 실행 (ios/fastlane/Fastfile 사용)
```


수정 후 자체 점검:
```bash
grep -n "util/flutter\|웹 마법사\|마법사가 생성\|마법사 생성" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml   # 출력 없음
grep -c "Prepare env file" payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml                                         # 1
grep -n "find " payload/workflows/flutter/PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml                                                    # FLUTTER_PROJECT_DIR 경로 1줄
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-workflows-payload.test.js`
Expected: 전체(Task 18~24 케이스 모두) PASS.

- [ ] **Step 5: 기존 payload 테스트 회귀 확인**

Run: `node --test tests/node/payload-yaml.test.js tests/node/payload-example-values.test.js tests/node/no-coderabbit.test.js tests/node/legacy-naming-guard.test.js tests/node/workflow-action-versions.test.js tests/node/wizard-env.test.js tests/node/e2e-matrix.test.js tests/node/workflows-copied-files.test.js`
Expected: 전부 PASS (`IOS-TEST-TESTFLIGHT: flutter pub get 직후 build_runner 조건부 코드 생성` 포함). 마지막으로 전체 회귀: `npm run test:node` — 실패가 이 Task 밖 원인이면(D1~D4·D6 미반영) 그 사실만 기록하고 넘어간다.

### Task 25: Play Store 배포 Fastfile 템플릿 + 템플릿 계약 테스트 파일 생성

**Files:**
- Create: `payload/flutter-app/android/fastlane/Fastfile.playstore`
- Create: `tests/node/flutter-app-templates.test.js` (Android 케이스 9개와 공용 헬퍼. Task 26이 iOS 케이스를 이어서 추가한다)

**Interfaces:**
- 소비하는 계약(공통 계약 §8): Fastfile은 환경변수 `AAB_PATH`, `GOOGLE_PLAY_JSON_KEY`, `VERSION_NAME`, `VERSION_CODE`, `DEPLOY_MODE`, `PACKAGE_NAME`을 읽는다. 변경 이력은 `android/fastlane/metadata/android/ko-KR/changelogs/<VERSION_CODE>.txt`(워크플로우가 만든다).
- 제공하는 것: lane `deploy_internal`. 워크플로우(`PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`)가 이 파일을 `android/fastlane/Fastfile`로 복사한 뒤 `cd android && bundle exec fastlane deploy_internal`로 실행한다. D2의 `copyFlutterAppFiles`는 이 파일을 `<Flutter 루트>/android/fastlane/Fastfile.playstore`로 복사한다(있으면 덮어쓰지 않음).
- 모드 매핑: `store_only`=internal 트랙 completed / `store_prepare`=production 트랙 draft / `store_submit`=production 트랙 completed. 알 수 없는 값·빈 값은 `store_only`.
- 다른 Task와의 관계: `PACKAGE_NAME` export는 D5가 워크플로우에 추가한다. 이 Task의 테스트는 그 항목을 워크플로우 텍스트로 검증하지 않고 계약 상수(`ANDROID_ENV`)로만 고정한다(D5 적용 전후 모두 통과해야 하므로).

**조사 근거 (fastlane 공식 문서 + fastlane 2.240.1 gem 소스로 교차 확인. 이 머신에서 gem을 임시 디렉토리에 설치해 실제 lane을 실행해 검증함):**
- `upload_to_play_store`(supply) 파라미터: `package_name`, `json_key`, `aab`, `track`, `release_status`(값 `completed`/`draft`/`halted`/`inProgress`, 기본 `completed`), `version_name`, `version_code`, `metadata_path`, `skip_upload_apk`, `skip_upload_aab`, `skip_upload_metadata`, `skip_upload_changelogs`, `skip_upload_images`, `skip_upload_screenshots`. 공식 문서(Context7 `/fastlane/docs`의 upload_to_play_store.md)와 gem의 `supply/lib/supply/options.rb` 키가 일치한다.
- `version_code:`는 넘기지 않는다. 문서상 "롤아웃 갱신·메타데이터/스크린샷 업로드용"이고, AAB 업로드 시 버전 코드는 업로드한 번들에서 얻는다(`supply/uploader.rb`의 `apk_version_codes`). 변경 이력 파일은 `<metadata_path>/<언어>/changelogs/<version_code>.txt`를 이 값으로 찾는다(`uploader.rb`의 `upload_changelog`). `VERSION_CODE`는 변경 이력 파일 존재 확인과 필수 값 검증에만 쓴다.
- `skip_upload_changelogs`는 `skip_upload_metadata`와 별개다(공식 문서 "New Options"). 그래서 `skip_upload_metadata: true`로 스토어 등록정보는 건드리지 않으면서 변경 이력만 올릴 수 있다. `skip_upload_apk: true`는 AAB만 올리는 경로에서 APK 탐색을 막는다.
- `metadata_path` 기본값은 `(Dir["./fastlane/metadata/android"] + Dir["./metadata"]).first`(동적)인데, fastlane은 lane을 Fastfile이 있는 `fastlane/` 디렉토리로 `chdir`해서 실행한다(`runner.rb`의 `Dir.chdir(FastlaneCore::FastlaneFolder.path ...)`). 그래서 상대경로 기본값에 기대지 않고 `File.expand_path("metadata/android")`로 명시해 워크플로우가 만드는 `android/fastlane/metadata/android`와 정확히 맞춘다. 실제로 lane을 실행해 변경 이력 파일이 발견됨을 확인했다.
- `track`은 `production`/`beta`/`alpha`/`internal` 문자열.
- 스스로 정한 사항: 내부 트랙(`store_only`)의 release_status는 문서 기본값인 `completed`로 둔다. Play 쪽 제약으로 draft가 필요한 경우는 사용자가 이 파일에서 바꾸는 것을 전제한다(상단 안내에 "사용자 소유" 명시).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/node/flutter-app-templates.test.js`를 아래 전문으로 생성한다.

```js
// tests/node/flutter-app-templates.test.js
// payload/flutter-app/ 아래 스토어 배포 템플릿(Fastfile·ExportOptions.plist)의 계약 검증 (이슈 #131).
//
// 이 파일들은 설치 후 사용자가 직접 편집한다. 그래서 Ruby 문법, 워크플로우가 넘기는 환경변수와의
// 정합성, 배포 모드 분기, 자리표시자 규약이 깨지면 사용자 레포에서 CI가 처음 돌 때서야 드러난다 —
// 여기서 미리 고정한다. Ruby·plutil이 없는 환경(Windows·Linux CI 등)에서는 해당 검사만 건너뛴다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP_DIR = join(REPO_ROOT, "payload", "flutter-app");
const WORKFLOW_DIR = join(REPO_ROOT, "payload", "workflows", "flutter");

const readApp = (relativePath) => readFileSync(join(APP_DIR, relativePath), "utf8");
const readWorkflow = (name) => readFileSync(join(WORKFLOW_DIR, `PROJECT-FLUTTER-${name}.yaml`), "utf8");

const canRun = (command, args) => spawnSync(command, args, { encoding: "utf8" }).status === 0;
const HAS_RUBY = canRun("ruby", ["-v"]);
const HAS_PLUTIL = canRun("plutil", ["-help"]);
const SKIP_RUBY = HAS_RUBY ? false : "ruby가 없어 건너뜀";

// Fastfile이 읽는 환경변수 이름 집합: ENV["NAME"] 직접 참조와 require_env("NAME") 헬퍼 호출
const envNamesRead = (fastfileText) =>
  new Set([...fastfileText.matchAll(/(?:ENV\[|require_env\()"([A-Z][A-Z0-9_]*)"[\])]/g)].map((m) => m[1]));

// 워크플로우가 fastlane에 내보내는 환경변수 이름 집합: `export NAME=` 또는 YAML `NAME:` 키.
// (env: 블록으로 넘기든 export로 넘기든 같은 계약이므로 둘 다 인정한다)
const envNamesProvided = (workflowText) =>
  new Set([
    ...[...workflowText.matchAll(/export\s+([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]),
    ...[...workflowText.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]),
  ]);

const missingFrom = (required, actualSet) => required.filter((name) => !actualSet.has(name));

// ---------------------------------------------------------------------------
// Android: android/fastlane/Fastfile.playstore (lane deploy_internal)
// ---------------------------------------------------------------------------
const ANDROID_FASTFILE = "android/fastlane/Fastfile.playstore";

// 공통 계약 §8 — 워크플로우가 내보내고 Fastfile이 읽는 환경변수
const ANDROID_ENV = ["AAB_PATH", "GOOGLE_PLAY_JSON_KEY", "VERSION_NAME", "VERSION_CODE", "DEPLOY_MODE", "PACKAGE_NAME"];

test("Fastfile.playstore는 Ruby 문법이 유효하다", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, ANDROID_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c 실패:\n${result.stderr}`);
});

test("Fastfile.playstore 상단에 사용자 소유 안내와 모드 매핑 표가 있다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /이 파일은 사용자 소유입니다\. 모드별 동작을 여기서 수정하세요/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(text.split("default_platform")[0], new RegExp(mode), `모드 표에 ${mode}가 없습니다`);
  }
});

test("Fastfile.playstore에 lane deploy_internal이 있다", () => {
  assert.match(readApp(ANDROID_FASTFILE), /^\s*lane :deploy_internal do$/m);
});

test("Fastfile.playstore가 읽는 환경변수는 공통 계약 §8과 정확히 같다", () => {
  const read = envNamesRead(readApp(ANDROID_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...ANDROID_ENV].sort());
});

test("Fastfile.playstore는 PACKAGE_NAME이 비면 한국어 안내와 함께 중단한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(
    text,
    /if package_name\.empty\?\s*\n\s*UI\.user_error!\("[^"\n]*ANDROID_PACKAGE_NAME secrets\/variables를 등록하세요/,
  );
});

test("Fastfile.playstore는 배포 모드 3종을 트랙·상태로 매핑하고 모르는 값은 store_only로 처리한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  assert.match(text, /when "store_prepare"\s*\n\s*\["production", "draft"\]/);
  assert.match(text, /when "store_submit"\s*\n\s*\["production", "completed"\]/);
  assert.match(text, /when "store_only"\s*\n\s*\["internal", "completed"\]/);
  // else 분기(알 수 없는 값)도 store_only와 같은 internal 업로드
  assert.match(text, /else\s*\n\s*UI\.important\("알 수 없는 DEPLOY_MODE[^\n]*store_only[^\n]*\n\s*\["internal", "completed"\]/);
});

test("Fastfile.playstore의 upload_to_play_store 파라미터가 fastlane 공식 옵션 이름과 일치한다", () => {
  const text = readApp(ANDROID_FASTFILE);
  for (const param of [
    "package_name: package_name",
    "json_key: json_key",
    "aab: aab_path",
    "track: track",
    "release_status: release_status",
    "version_name: version_name",
    "metadata_path: metadata_path",
    "skip_upload_apk: true",
    "skip_upload_metadata: true",
    "skip_upload_images: true",
    "skip_upload_screenshots: true",
  ]) {
    assert.ok(text.includes(param), `upload_to_play_store에 ${param}가 없습니다`);
  }
  // 변경 이력은 워크플로우가 만든 changelogs/<VERSION_CODE>.txt를 올려야 하므로 건너뛰면 안 된다
  assert.doesNotMatch(text, /skip_upload_changelogs:\s*true/);
});

test("Fastfile.playstore의 metadata_path가 PLAYSTORE 워크플로우가 만드는 changelogs 경로의 상위와 일치한다", () => {
  const fastfile = readApp(ANDROID_FASTFILE);
  const workflow = readWorkflow("ANDROID-PLAYSTORE-CICD");
  // lane은 Fastfile이 있는 android/fastlane에서 실행되므로 metadata/android가 곧
  // android/fastlane/metadata/android 이다.
  assert.match(fastfile, /File\.expand_path\("metadata\/android"\)/);
  assert.match(fastfile, /File\.join\(metadata_path, "ko-KR", "changelogs", "#\{version_code\}\.txt"\)/);
  assert.ok(workflow.includes("android/fastlane/metadata/android/ko-KR/changelogs"), "워크플로우의 changelogs 경로가 바뀌었습니다");
  assert.ok(workflow.includes("cp android/fastlane/Fastfile.playstore android/fastlane/Fastfile"), "워크플로우가 Fastfile.playstore를 Fastfile로 복사하지 않습니다");
  assert.ok(workflow.includes("bundle exec fastlane deploy_internal"), "워크플로우가 deploy_internal lane을 호출하지 않습니다");
});

test("PLAYSTORE 워크플로우는 Fastfile이 읽는 환경변수를 내보낸다", () => {
  // PACKAGE_NAME은 워크플로우 쪽(D5)에서 이번 이슈로 추가하는 값이라 이 파일의 현재 상태로는
  // 검증하지 않는다 — 위의 계약 §8 상수(ANDROID_ENV)로만 고정한다.
  const provided = envNamesProvided(readWorkflow("ANDROID-PLAYSTORE-CICD"));
  const required = ANDROID_ENV.filter((name) => name !== "PACKAGE_NAME");
  assert.deepStrictEqual(missingFrom(required, provided), [], "워크플로우가 내보내지 않는 환경변수를 Fastfile이 읽습니다");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-app-templates.test.js`
Expected: Android Fastfile을 읽는 8개 케이스가 `ENOENT`(또는 `ruby -c` 실패)로 FAIL, `PLAYSTORE 워크플로우는 Fastfile이 읽는 환경변수를 내보낸다` 1개만 PASS. ruby가 없는 머신이면 문법 케이스는 skip으로 표시된다.

- [ ] **Step 3: Fastfile.playstore 작성** — `payload/flutter-app/android/fastlane/Fastfile.playstore`를 아래 전문으로 생성한다(디렉토리는 `mkdir -p payload/flutter-app/android/fastlane`). LF 줄바꿈, 파일 끝 개행 1개.

```ruby
# ===================================================================
# 이 파일은 사용자 소유입니다. 모드별 동작을 여기서 수정하세요.
# ===================================================================
#
# Google Play 배포용 Fastfile 템플릿입니다.
# PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD 워크플로우가 이 파일을 android/fastlane/Fastfile로
# 복사한 뒤 `bundle exec fastlane deploy_internal`을 실행합니다.
# project-auto-wizard는 이 파일이 이미 있으면 덮어쓰지 않으므로 자유롭게 수정해도 됩니다.
#
# 배포 모드 (워크플로우가 DEPLOY_MODE 환경변수로 전달)
# ┌───────────────┬────────────┬──────────────────┬──────────────────────────────┐
# │ DEPLOY_MODE   │ track      │ release_status   │ 동작                         │
# ├───────────────┼────────────┼──────────────────┼──────────────────────────────┤
# │ store_only    │ internal   │ completed        │ 내부 테스트 트랙에 업로드    │
# │ store_prepare │ production │ draft            │ 프로덕션에 초안으로 업로드   │
# │               │            │                  │ (Play Console에서 직접 출시) │
# │ store_submit  │ production │ completed        │ 프로덕션 심사 제출까지 진행  │
# └───────────────┴────────────┴──────────────────┴──────────────────────────────┘
# 알 수 없는 값이나 빈 값은 store_only로 처리합니다.
#
# 워크플로우가 넘기는 환경변수
#   PACKAGE_NAME          앱 패키지명 (ANDROID_PACKAGE_NAME secrets/variables)
#   AAB_PATH              업로드할 .aab 절대경로
#   GOOGLE_PLAY_JSON_KEY  서비스 계정 JSON 키 파일 경로
#   VERSION_NAME          버전 이름 (Play Console의 릴리스 이름)
#   VERSION_CODE          버전 코드 (변경 이력 파일명과 일치)
#   DEPLOY_MODE           위 표의 배포 모드
#
# 변경 이력은 워크플로우가 android/fastlane/metadata/android/ko-KR/changelogs/<VERSION_CODE>.txt
# 로 만들어 두며, upload_to_play_store가 metadata_path 아래에서 버전 코드로 찾아 업로드합니다.

default_platform(:android)

platform :android do
  desc "AAB를 Google Play에 업로드합니다 (DEPLOY_MODE: store_only | store_prepare | store_submit)"
  lane :deploy_internal do
    package_name = ENV["PACKAGE_NAME"].to_s.strip
    if package_name.empty?
      UI.user_error!("PACKAGE_NAME이 비어 있습니다. ANDROID_PACKAGE_NAME secrets/variables를 등록하세요. (예: com.example.app)")
    end

    aab_path = ENV["AAB_PATH"].to_s.strip
    json_key = ENV["GOOGLE_PLAY_JSON_KEY"].to_s.strip
    version_name = ENV["VERSION_NAME"].to_s.strip
    version_code = ENV["VERSION_CODE"].to_s.strip
    if aab_path.empty? || json_key.empty? || version_name.empty? || version_code.empty?
      UI.user_error!("AAB_PATH, GOOGLE_PLAY_JSON_KEY, VERSION_NAME, VERSION_CODE 환경변수가 모두 필요합니다. 워크플로우에서 전달하는지 확인하세요.")
    end

    deploy_mode = ENV["DEPLOY_MODE"].to_s.strip
    track, release_status =
      case deploy_mode
      when "store_prepare"
        ["production", "draft"]
      when "store_submit"
        ["production", "completed"]
      when "store_only"
        ["internal", "completed"]
      else
        UI.important("알 수 없는 DEPLOY_MODE '#{deploy_mode}' 입니다. store_only로 처리합니다.") unless deploy_mode.empty?
        ["internal", "completed"]
      end

    # lane은 Fastfile이 있는 android/fastlane 디렉토리에서 실행되므로,
    # 워크플로우가 변경 이력을 만드는 android/fastlane/metadata/android와 같은 경로를 가리킵니다.
    metadata_path = File.expand_path("metadata/android")
    changelog_file = File.join(metadata_path, "ko-KR", "changelogs", "#{version_code}.txt")
    UI.important("변경 이력 파일이 없습니다: #{changelog_file}") unless File.exist?(changelog_file)

    UI.message("Play 배포: DEPLOY_MODE=#{deploy_mode.inspect} → track=#{track}, release_status=#{release_status}")

    upload_to_play_store(
      package_name: package_name,
      json_key: json_key,
      aab: aab_path,
      track: track,
      release_status: release_status,
      version_name: version_name,
      metadata_path: metadata_path,
      skip_upload_apk: true,
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true
    )
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/node/flutter-app-templates.test.js`
Expected: 9 tests pass, 0 fail.

Run(macOS 기본 ruby로 직접 문법 확인): `ruby -c payload/flutter-app/android/fastlane/Fastfile.playstore`
Expected: `Syntax OK`

- [ ] **Step 5: 기존 페이로드 가드 통과 확인** (새 파일이 CRLF·종속 이름 검사에 걸리지 않는지)

Run: `node --test tests/node/legacy-naming-guard.test.js tests/node/line-endings.test.js`
Expected: 모두 pass. (`payload/` 아래 파일에 `suh`, `projectops` 문자열이 없어야 한다.)

---

### Task 26: iOS 배포 Fastfile·ExportOptions.plist 템플릿 + iOS 계약 테스트 추가

**Files:**
- Create: `payload/flutter-app/ios/fastlane/Fastfile`
- Create: `payload/flutter-app/ios/ExportOptions.plist`
- Modify: `tests/node/flutter-app-templates.test.js` (Task 25에서 만든 파일 끝에 iOS·plist 케이스 18개를 이어 붙인다)

**Interfaces:**
- 소비하는 계약(공통 계약 §8):
  - lane `deploy`: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `API_KEY_PATH`, `IPA_PATH`, `RELEASE_NOTES`, `APP_IDENTIFIER`, `DEPLOY_MODE`, `APP_VERSION`, `BUILD_NUMBER`, `SKIP_WAITING_FOR_BUILD_PROCESSING`.
  - lane `upload_testflight`: `API_KEY_PATH`, `IPA_PATH`, `RELEASE_NOTES`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`(+ `APP_IDENTIFIER`는 오지 않을 수 있어 있을 때만 사용).
- 제공하는 것: `ios/fastlane/Fastfile`(lane `deploy`, `upload_testflight`)과 `ios/ExportOptions.plist`. D2가 `<Flutter 루트>/ios/fastlane/Fastfile`, `<Flutter 루트>/ios/ExportOptions.plist`로 복사한다(있으면 덮어쓰지 않음).
- **ExportOptions.plist 플레이스홀더(D3 doctor·D5 IOS-TESTFLIGHT 검증이 소비)**: `__TEAM_ID__`, `__BUNDLE_ID__`, `__PROVISIONING_PROFILE_NAME__` 3개. 미치환 감지 정규식(JS) `/__[A-Z][A-Z0-9_]*__/`, 셸 `grep -Eq '__[A-Z][A-Z0-9_]*__' <파일>`. 파일 상단 주석에는 이 토큰을 절대 적지 않는다(값을 채운 뒤에도 감지가 계속 걸리는 것을 막기 위함이며 테스트가 이를 고정한다).
- 워크플로우와의 정합(`PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`·`IOS-TEST-TESTFLIGHT.yaml`을 읽고 확인): 두 워크플로우 모두 `cd ios` 후 `xcodebuild -exportArchive -archivePath build/Runner.xcarchive -exportPath build/ipa -exportOptionsPlist ExportOptions.plist`로 이 파일을 쓰고, 아카이브 단계에서 `CODE_SIGN_STYLE=Manual`, `PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE_NAME"`(Secret `IOS_PROVISIONING_PROFILE_NAME`), `CODE_SIGN_IDENTITY="Apple Distribution"`을 쓴다. 그래서 plist는 `signingStyle=manual`, `signingCertificate=Apple Distribution`, `provisioningProfiles` 매핑(번들 ID → 프로파일 이름)으로 같은 값을 가리키고, 프로파일 이름 칸은 같은 Secret 값을 넣으라고 안내한다. plist는 레포에 커밋되는 정적 파일이라 Secret을 직접 참조할 수 없으므로 사용자가 값을 채우는 방식이다.
- 워크플로우는 `cd ios` 후 `bundle exec fastlane deploy` / `upload_testflight`를 호출하므로 lane 실행 위치는 `ios/fastlane`이다. `deploy`는 `IOS-TESTFLIGHT`(main push, DEPLOY_MODE 전달), `upload_testflight`는 `IOS-TEST-TESTFLIGHT`(DEPLOY_MODE 없음)가 쓴다.

**조사 근거 (fastlane 공식 문서 + fastlane 2.240.1 gem 소스로 교차 확인. 임시 설치한 fastlane으로 lane을 실제 실행해 옵션을 검증함):**
- 인증: `app_store_connect_api_key(key_id:, issuer_id:, key_filepath:)`가 API 키 해시를 돌려주고 이를 `api_key:`로 pilot·deliver에 넘긴다(공식 문서 App Store Connect API 페이지의 예제와 동일, gem의 `app_store_connect_api_key.rb` 키 `key_id`/`issuer_id`/`key_filepath`/`key_content` 확인). 실제 P-256 `.p8` 키로 실행해 `upload_to_testflight` 단계까지 진입함을 확인했다(인증 오류는 더미 키라 예상된 결과).
- `upload_to_testflight`(pilot): `api_key`, `app_identifier`, `ipa`, `changelog`("What to Test"), `skip_waiting_for_build_processing`(기본 false), `skip_submission`, `distribute_external` 확인. `changelog`는 값이 있을 때만 넘긴다. 이 lane은 내부 테스터용 업로드이므로 `distribute_external`은 쓰지 않는다.
- `upload_to_app_store`(deliver): `api_key`, `app_identifier`, `app_version`, `build_number`(이미 업로드된 빌드를 지정, `ipa`/`pkg`와 동시 사용 불가), `skip_binary_upload`, `skip_screenshots`, `skip_metadata`, `skip_app_version_update`, `submit_for_review`(기본 false), `automatic_release`(Boolean, 기본값 없음), `force`(HTML 미리보기 검증 생략, CI 필수)를 확인했고, `Deliver::Options`/`Pilot::Options`에 이 해시를 그대로 넣어 `FastlaneCore::Configuration.create`가 통과함을 실행으로 확인했다. 공식 문서의 "Submit build" 예제(`build_number`, `submit_for_review: true`, `skip_metadata`/`skip_screenshots`/`skip_binary_upload: true`, `force: true`)와 같은 조합이다.
- **store_prepare 조합(근거)**: 워크플로우 `IOS-TESTFLIGHT`는 `DEPLOY_MODE`를 Fastfile에 그대로 export할 뿐 모드별 특수 처리를 하지 않는다(`workflow_dispatch` 입력 설명은 store_prepare를 "ASC 제출직전"으로 표기). 그래서 (1) `upload_to_testflight`로 IPA를 올리고 빌드 처리 완료까지 기다린 뒤 (2) `upload_to_app_store(skip_binary_upload: true, build_number:, app_version:, submit_for_review: false)`로 "심사 준비 중" 버전을 만들고 그 빌드를 연결한다. store_submit은 (2)에서 `submit_for_review: true`만 다르다.
- 스스로 정한 사항: (a) store_prepare/store_submit은 `skip_waiting_for_build_processing`을 무시하고 항상 처리 완료를 기다린다. 빌드가 처리되기 전에는 deliver가 빌드를 선택할 수 없기 때문이며, pilot 옵션 설명에도 skip 시 처리 단계를 건너뛴다고 되어 있다. (b) 메타데이터는 `ios/fastlane/metadata/` 아래에 파일이 있을 때만 올린다(`skip_metadata: Dir.glob("metadata/*").empty?`). deliver는 metadata 폴더가 없으면 기본 위치 `<fastlane 폴더>/metadata`를 `mkdir_p`로 만들기 때문에(`deliver/detect_values.rb`) 디렉토리 존재 여부가 아니라 내용 유무로 판단한다. "What's New" 같은 문구를 이 파일에서 임의로 만들지 않는다. (c) `automatic_release: false`(승인 후 자동 출시하지 않음)로 둔다. (d) 스크린샷은 올리지 않는다. (e) 수출 규정(`submission_information`)은 앱마다 답이 달라 값을 정하지 않고, deliver가 제출 시 요구하는 오류 안내(`submit_for_review.rb`)를 주석으로 옮겼다.
- **ExportOptions.plist의 `method` 값**: 지시서는 `app-store`였으나 이 머신의 `xcodebuild -help`(Xcode 27)가 "`app-store`는 deprecated, `app-store-connect`를 사용"이라고 명시하고, 워크플로우는 Xcode 26.0을 고정 사용하므로(15.3 이상에서 유효) `app-store-connect`로 작성했다. 되돌리려면 plist 한 줄과 테스트의 `app-store-connect` 두 곳(정규식, `plutil` 추출)만 바꾸면 된다. 그 밖의 키(`teamID`, `signingStyle`, `signingCertificate`, `provisioningProfiles`)도 같은 `xcodebuild -help` 출력으로 확인했다.
- 로컬에서 확인할 수 없는 것: 실제 App Store Connect 통신(업로드·심사 제출)은 PR 이후 테스트 레포에서 확인할 항목이다.

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/node/flutter-app-templates.test.js` 파일 끝에 아래 전문을 그대로 이어 붙인다(Task 25에서 만든 `readApp`, `readWorkflow`, `envNamesRead`, `envNamesProvided`, `missingFrom`, `SKIP_RUBY`, `HAS_PLUTIL`, `APP_DIR`, `spawnSync`, `join`, `assert`, `test`를 그대로 쓰므로 import 추가는 없다).

```js
// ---------------------------------------------------------------------------
// iOS: ios/fastlane/Fastfile (lane deploy, upload_testflight)
// ---------------------------------------------------------------------------
const IOS_FASTFILE = "ios/fastlane/Fastfile";
const EXPORT_OPTIONS = "ios/ExportOptions.plist";

// 공통 계약 §8 — deploy lane이 받는 환경변수 (upload_testflight lane은 이 중 일부)
const IOS_DEPLOY_ENV = [
  "APP_STORE_CONNECT_API_KEY_ID",
  "APP_STORE_CONNECT_ISSUER_ID",
  "API_KEY_PATH",
  "IPA_PATH",
  "RELEASE_NOTES",
  "APP_IDENTIFIER",
  "DEPLOY_MODE",
  "APP_VERSION",
  "BUILD_NUMBER",
  "SKIP_WAITING_FOR_BUILD_PROCESSING",
];
// APP_IDENTIFIER는 upload_testflight 쪽 워크플로우가 내보내지 않으므로 여기서 뺀다
// (있으면 사용, 없으면 fastlane이 추론).
const IOS_UPLOAD_ENV = ["API_KEY_PATH", "IPA_PATH", "RELEASE_NOTES", "APP_STORE_CONNECT_API_KEY_ID", "APP_STORE_CONNECT_ISSUER_ID"];

// `lane :<name> do` 부터 들여쓰기 2칸의 `end`까지
const laneBody = (fastfileText, laneName) => {
  const match = fastfileText.match(new RegExp(`^  lane :${laneName} do\\n([\\s\\S]*?)^  end$`, "m"));
  assert.ok(match, `lane :${laneName}을 찾을 수 없습니다`);
  return match[1];
};

test("ios Fastfile은 Ruby 문법이 유효하다", { skip: SKIP_RUBY }, () => {
  const result = spawnSync("ruby", ["-c", join(APP_DIR, IOS_FASTFILE)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `ruby -c 실패:\n${result.stderr}`);
});

test("ios Fastfile 상단에 사용자 소유 안내와 모드 매핑 표가 있다", () => {
  const header = readApp(IOS_FASTFILE).split("default_platform")[0];
  assert.match(header, /이 파일은 사용자 소유입니다\. 모드별 동작을 여기서 수정하세요/);
  for (const mode of ["store_only", "store_prepare", "store_submit"]) {
    assert.match(header, new RegExp(mode), `모드 표에 ${mode}가 없습니다`);
  }
});

test("ios Fastfile에 lane deploy와 upload_testflight가 있다", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(text, /^  lane :deploy do$/m);
  assert.match(text, /^  lane :upload_testflight do$/m);
});

test("ios Fastfile이 읽는 환경변수는 공통 계약 §8과 정확히 같다", () => {
  const read = envNamesRead(readApp(IOS_FASTFILE));
  assert.deepStrictEqual([...read].sort(), [...IOS_DEPLOY_ENV].sort());
});

test("upload_testflight lane은 IPA 업로드만 하고 배포 모드·App Store 단계를 쓰지 않는다", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "upload_testflight");
  assert.match(body, /upload_ipa_to_testflight\(/);
  for (const forbidden of ["DEPLOY_MODE", "APP_VERSION", "BUILD_NUMBER", "upload_to_app_store", "submit_for_review"]) {
    assert.ok(!body.includes(forbidden), `upload_testflight lane에 ${forbidden}가 있습니다`);
  }
});

test("ios Fastfile은 App Store Connect API 키로 인증한다", () => {
  const text = readApp(IOS_FASTFILE);
  assert.match(
    text,
    /app_store_connect_api_key\(\s*\n\s*key_id: require_env\("APP_STORE_CONNECT_API_KEY_ID"\),\s*\n\s*issuer_id: require_env\("APP_STORE_CONNECT_ISSUER_ID"\),\s*\n\s*key_filepath: require_env\("API_KEY_PATH"\)/,
  );
  assert.match(text, /api_key: api_key/);
});

test("ios Fastfile은 필수 환경변수가 비면 한국어 안내와 함께 중단한다", () => {
  assert.match(
    readApp(IOS_FASTFILE),
    /UI\.user_error!\("#\{name\} 환경변수가 비어 있습니다\. 워크플로우에서 값을 전달하는지 확인하세요\."\)/,
  );
});

test("upload_testflight 경로는 APP_IDENTIFIER가 있을 때만 넘기고, deploy의 store_prepare/store_submit은 필수로 요구한다", () => {
  const text = readApp(IOS_FASTFILE);
  // pilot(TestFlight 업로드) 쪽은 옵션 — IOS-TEST-TESTFLIGHT 워크플로우가 APP_IDENTIFIER를 안 보내도 된다.
  assert.match(text, /app_identifier\.empty\? \? \{\} : \{ app_identifier: app_identifier \}/);
  const upload_testflight_helper = text.split("def app_identifier_option")[1].split("def upload_ipa_to_testflight")[0];
  assert.doesNotMatch(upload_testflight_helper, /require_env\("APP_IDENTIFIER"\)/);
  // deliver(App Store 버전 연결)는 APP_IDENTIFIER가 비면 UI.input으로 멈추므로(대화형 입력 대기),
  // store_prepare/store_submit 분기는 require_env로 필수화해 CI에서 명확한 오류로 중단시킨다.
  const deployBody = laneBody(text, "deploy");
  const prepareSubmitBranch = deployBody.split('when "store_only"')[0];
  assert.match(prepareSubmitBranch, /app_identifier: require_env\("APP_IDENTIFIER"\)/);
});

test("ios Fastfile의 upload_to_testflight 파라미터가 fastlane 공식 옵션 이름과 일치한다", () => {
  const text = readApp(IOS_FASTFILE);
  for (const param of [
    "api_key: api_key",
    'ipa: require_env("IPA_PATH")',
    "skip_waiting_for_build_processing: skip_waiting_for_build_processing",
    "options[:changelog] = release_notes",
    "upload_to_testflight(**options, **app_identifier_option)",
  ]) {
    assert.ok(text.includes(param), `upload_to_testflight에 ${param}가 없습니다`);
  }
});

test("ios Fastfile은 배포 모드 3종을 분기하고 store_prepare는 심사 제출을 하지 않는다", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /when "store_prepare", "store_submit"/);
  assert.match(body, /when "store_only"/);
  // 모르는 값과 빈 값은 store_only와 같은 TestFlight 업로드로 처리
  assert.match(body, /else\n\s*UI\.important\("알 수 없는 DEPLOY_MODE[^\n]*store_only[^\n]*\n\s*upload_ipa_to_testflight\(/);
  // 심사 제출 여부는 store_submit일 때만 true — store_prepare는 false
  assert.match(body, /submit_for_review: deploy_mode == "store_submit"/);
  // 업로드는 TestFlight(pilot)가 하고, deliver는 이미 올라간 빌드를 App Store 버전에 연결만 한다
  for (const param of [
    "skip_binary_upload: true",
    "skip_screenshots: true",
    'app_version: require_env("APP_VERSION")',
    'build_number: require_env("BUILD_NUMBER")',
    "automatic_release: false",
    "force: true",
    "precheck_include_in_app_purchases: false",
  ]) {
    assert.ok(body.includes(param), `upload_to_app_store에 ${param}가 없습니다`);
  }
  assert.match(body, /skip_metadata: Dir\.glob\("metadata\/\*"\)\.empty\?/);
});

test("upload_to_app_store는 precheck_include_in_app_purchases:false로 인앱 결제 사전 검사 크래시를 피한다", () => {
  // deliver의 precheck는 App Store Connect API 키 인증에서 인앱 결제 항목을 확인할 수 없어
  // 기본값(true)으로 두면 UI.user_error!로 중단된다 (fastlane deliver/runner.rb precheck_app).
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  assert.match(body, /precheck_include_in_app_purchases: false/);
});

test("store_prepare/store_submit은 빌드 처리 완료를 기다린다(SKIP_WAITING 무시)", () => {
  const body = laneBody(readApp(IOS_FASTFILE), "deploy");
  const prepareBranch = body.split('when "store_only"')[0];
  assert.match(prepareBranch, /upload_ipa_to_testflight\(api_key, false\)/);
  assert.ok(!prepareBranch.includes("SKIP_WAITING_FOR_BUILD_PROCESSING"));
});

test("IOS-TESTFLIGHT 워크플로우는 deploy lane이 읽는 환경변수를 모두 내보낸다", () => {
  const workflow = readWorkflow("IOS-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_DEPLOY_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane deploy"), "워크플로우가 deploy lane을 호출하지 않습니다");
});

test("IOS-TEST-TESTFLIGHT 워크플로우는 upload_testflight lane이 읽는 환경변수를 내보낸다", () => {
  const workflow = readWorkflow("IOS-TEST-TESTFLIGHT");
  assert.deepStrictEqual(missingFrom(IOS_UPLOAD_ENV, envNamesProvided(workflow)), []);
  assert.ok(workflow.includes("bundle exec fastlane upload_testflight"), "워크플로우가 upload_testflight lane을 호출하지 않습니다");
});

// ---------------------------------------------------------------------------
// iOS: ios/ExportOptions.plist
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERN = /__[A-Z][A-Z0-9_]*__/g; // 공통 계약 §8의 미치환 감지 정규식(전역 플래그만 추가)
const PLIST_PLACEHOLDERS = ["__TEAM_ID__", "__BUNDLE_ID__", "__PROVISIONING_PROFILE_NAME__"];

const plutilExtract = (keyPath) => {
  const result = spawnSync("plutil", ["-extract", keyPath, "raw", "-o", "-", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, `plutil -extract ${keyPath} 실패:\n${result.stderr}`);
  return result.stdout.trim();
};

test("ExportOptions.plist에는 계약 §8의 플레이스홀더 3개만 있고 감지 정규식에 걸린다", () => {
  const found = [...new Set(readApp(EXPORT_OPTIONS).match(PLACEHOLDER_PATTERN) ?? [])].sort();
  assert.deepStrictEqual(found, [...PLIST_PLACEHOLDERS].sort());
});

test("ExportOptions.plist는 값을 채우면 플레이스홀더가 하나도 남지 않는다(주석에 남기지 않는다)", () => {
  let filled = readApp(EXPORT_OPTIONS);
  for (const placeholder of PLIST_PLACEHOLDERS) filled = filled.replaceAll(placeholder, "filled-value");
  assert.doesNotMatch(filled, /__[A-Z][A-Z0-9_]*__/);
});

test("ExportOptions.plist는 App Store 배포·수동 서명·프로파일 매핑을 지정한다", () => {
  const text = readApp(EXPORT_OPTIONS);
  assert.match(text, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(text, /<key>teamID<\/key>\s*<string>__TEAM_ID__<\/string>/);
  assert.match(text, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(
    text,
    /<key>provisioningProfiles<\/key>\s*<dict>\s*<key>__BUNDLE_ID__<\/key>\s*<string>__PROVISIONING_PROFILE_NAME__<\/string>\s*<\/dict>/,
  );
});

test("ExportOptions.plist는 plutil -lint를 통과하고 값이 예상대로 파싱된다", { skip: HAS_PLUTIL ? false : "plutil이 없어 건너뜀" }, () => {
  const lint = spawnSync("plutil", ["-lint", join(APP_DIR, EXPORT_OPTIONS)], { encoding: "utf8" });
  assert.strictEqual(lint.status, 0, `plutil -lint 실패:\n${lint.stdout}${lint.stderr}`);
  assert.strictEqual(plutilExtract("method"), "app-store-connect");
  assert.strictEqual(plutilExtract("teamID"), "__TEAM_ID__");
  assert.strictEqual(plutilExtract("signingStyle"), "manual");
  assert.strictEqual(plutilExtract("provisioningProfiles.__BUNDLE_ID__"), "__PROVISIONING_PROFILE_NAME__");
});

test("ExportOptions.plist는 iOS 워크플로우의 서명 설정과 모순되지 않는다", () => {
  const plist = readApp(EXPORT_OPTIONS);
  for (const name of ["IOS-TESTFLIGHT", "IOS-TEST-TESTFLIGHT"]) {
    const workflow = readWorkflow(name);
    // 워크플로우는 ios/ 디렉토리에서 이 파일을 -exportOptionsPlist로 사용한다
    assert.match(workflow, /-exportOptionsPlist ExportOptions\.plist/, `${name}: exportOptionsPlist 인자가 바뀌었습니다`);
    // 아카이브 서명 인증서와 export 서명 인증서가 같아야 한다
    const archiveIdentity = workflow.match(/CODE_SIGN_IDENTITY="([^"]+)"/)?.[1];
    assert.ok(archiveIdentity, `${name}: CODE_SIGN_IDENTITY를 찾을 수 없습니다`);
    assert.ok(plist.includes(`<string>${archiveIdentity}</string>`), `${name}: plist의 signingCertificate가 아카이브 인증서(${archiveIdentity})와 다릅니다`);
    // 프로파일 이름은 같은 Secret을 아카이브에 쓰므로 plist도 같은 이름을 안내해야 한다
    assert.ok(workflow.includes('PROVISIONING_PROFILE_SPECIFIER="$IOS_PROVISIONING_PROFILE_NAME"'), `${name}: 프로파일 Secret 사용처가 바뀌었습니다`);
  }
  assert.match(plist, /IOS_PROVISIONING_PROFILE_NAME/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/node/flutter-app-templates.test.js`
Expected: Task 25의 9개는 PASS. iOS Fastfile·plist 파일을 읽는 케이스 16개가 `ENOENT`로 FAIL. iOS 워크플로우 환경변수 2개 케이스는 워크플로우만 읽으므로 PASS.

- [ ] **Step 3: iOS Fastfile 작성** — `payload/flutter-app/ios/fastlane/Fastfile`을 아래 전문으로 생성한다(`mkdir -p payload/flutter-app/ios/fastlane`).

```ruby
# ===================================================================
# 이 파일은 사용자 소유입니다. 모드별 동작을 여기서 수정하세요.
# ===================================================================
#
# iOS 배포용 Fastfile 템플릿입니다. Flutter 워크플로우가 IPA를 만든 뒤
# `cd ios && bundle exec fastlane <lane>`으로 실행합니다.
# project-auto-wizard는 이 파일이 이미 있으면 덮어쓰지 않으므로 자유롭게 수정해도 됩니다.
#
# lane
#   deploy              PROJECT-FLUTTER-IOS-TESTFLIGHT 워크플로우 (DEPLOY_MODE에 따라 분기)
#   upload_testflight   PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT 워크플로우 (IPA를 TestFlight에 올리기만 함)
#
# deploy lane의 배포 모드 (워크플로우가 DEPLOY_MODE 환경변수로 전달)
# ┌───────────────┬──────────────────────────────────────────────────────────────┐
# │ DEPLOY_MODE   │ 동작                                                         │
# ├───────────────┼──────────────────────────────────────────────────────────────┤
# │ store_only    │ TestFlight 업로드까지 (upload_to_testflight)                 │
# │ store_prepare │ TestFlight 업로드 후, App Store 버전과 메타데이터를 준비     │
# │               │ (upload_to_app_store, submit_for_review: false). 빌드는 이   │
# │               │ 단계에서 버전에 연결되지 않고, store_submit이 build_number   │
# │               │ 로 다시 호출될 때 한번에 연결·제출됩니다.                    │
# │ store_submit  │ store_prepare와 같은 호출이고 심사 제출까지 진행             │
# │               │ (submit_for_review: true, 이때 빌드가 버전에 연결됩니다)     │
# └───────────────┴──────────────────────────────────────────────────────────────┘
# 알 수 없는 값이나 빈 값은 store_only로 처리합니다.
#
# 워크플로우가 넘기는 환경변수
#   APP_STORE_CONNECT_API_KEY_ID   App Store Connect API Key ID
#   APP_STORE_CONNECT_ISSUER_ID    App Store Connect Issuer ID
#   API_KEY_PATH                   AuthKey_XXXX.p8 파일 경로
#   IPA_PATH                       업로드할 .ipa 절대경로
#   RELEASE_NOTES                  TestFlight "What to Test" 문구 (changelog)
#   APP_IDENTIFIER                 번들 ID (upload_testflight lane은 없으면 fastlane이 추론하지만,
#                                  deploy lane의 store_prepare/store_submit은 필수입니다)
#   DEPLOY_MODE                    위 표의 배포 모드 (deploy lane만)
#   APP_VERSION, BUILD_NUMBER      앱 버전, 빌드 번호 (deploy lane만)
#   SKIP_WAITING_FOR_BUILD_PROCESSING  "true"면 빌드 처리 완료를 기다리지 않음 (store_only만 적용)
#
# 참고
# - store_prepare/store_submit은 App Store 버전에 빌드를 연결해야 하므로 빌드 처리가 끝날 때까지
#   기다립니다 (SKIP_WAITING_FOR_BUILD_PROCESSING을 무시).
# - 스크린샷은 올리지 않습니다. 메타데이터는 ios/fastlane/metadata/ 아래에 파일이 있을 때만 올립니다.
#   심사 제출 시 "What's New" 등 필수 항목은 이 폴더나 App Store Connect에서 미리 채워 두세요.
# - store_submit에서 수출 규정 오류가 나면 Info.plist에 ITSAppUsesNonExemptEncryption을 지정하거나
#   upload_to_app_store에 submission_information을 추가하세요.
# - store_submit은 심사 승인 후 자동 출시하지 않습니다 (automatic_release: false).

default_platform(:ios)

def require_env(name)
  value = ENV[name].to_s.strip
  UI.user_error!("#{name} 환경변수가 비어 있습니다. 워크플로우에서 값을 전달하는지 확인하세요.") if value.empty?
  value
end

def load_api_key
  app_store_connect_api_key(
    key_id: require_env("APP_STORE_CONNECT_API_KEY_ID"),
    issuer_id: require_env("APP_STORE_CONNECT_ISSUER_ID"),
    key_filepath: require_env("API_KEY_PATH")
  )
end

# APP_IDENTIFIER가 있을 때만 옵션에 포함해, 없으면 fastlane 기본 추론에 맡깁니다.
def app_identifier_option
  app_identifier = ENV["APP_IDENTIFIER"].to_s.strip
  app_identifier.empty? ? {} : { app_identifier: app_identifier }
end

def upload_ipa_to_testflight(api_key, skip_waiting_for_build_processing)
  options = {
    api_key: api_key,
    ipa: require_env("IPA_PATH"),
    skip_waiting_for_build_processing: skip_waiting_for_build_processing
  }
  release_notes = ENV["RELEASE_NOTES"].to_s.strip
  options[:changelog] = release_notes unless release_notes.empty?
  upload_to_testflight(**options, **app_identifier_option)
end

platform :ios do
  desc "IPA를 TestFlight에 업로드합니다 (테스트 빌드용)"
  lane :upload_testflight do
    upload_ipa_to_testflight(load_api_key, false)
  end

  desc "IPA를 업로드하고 DEPLOY_MODE에 따라 TestFlight / 심사 준비 / 심사 제출까지 진행합니다"
  lane :deploy do
    api_key = load_api_key
    deploy_mode = ENV["DEPLOY_MODE"].to_s.strip

    case deploy_mode
    when "store_prepare", "store_submit"
      UI.message("DEPLOY_MODE=#{deploy_mode}: 빌드 처리 완료까지 기다린 뒤 App Store 버전을 준비합니다.")
      upload_ipa_to_testflight(api_key, false)

      upload_to_app_store(
        api_key: api_key,
        app_identifier: require_env("APP_IDENTIFIER"),
        app_version: require_env("APP_VERSION"),
        build_number: require_env("BUILD_NUMBER"),
        skip_binary_upload: true,
        skip_screenshots: true,
        skip_metadata: Dir.glob("metadata/*").empty?,
        submit_for_review: deploy_mode == "store_submit",
        automatic_release: false,
        force: true,
        precheck_include_in_app_purchases: false
      )
    when "store_only"
      upload_ipa_to_testflight(api_key, ENV["SKIP_WAITING_FOR_BUILD_PROCESSING"].to_s.strip.downcase == "true")
    else
      UI.important("알 수 없는 DEPLOY_MODE '#{deploy_mode}' 입니다. store_only로 처리합니다.") unless deploy_mode.empty?
      upload_ipa_to_testflight(api_key, ENV["SKIP_WAITING_FOR_BUILD_PROCESSING"].to_s.strip.downcase == "true")
    end
  end
end
```

- [ ] **Step 4: ExportOptions.plist 작성** — `payload/flutter-app/ios/ExportOptions.plist`를 아래 전문으로 생성한다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  이 파일은 사용자 소유입니다. 밑줄 두 개로 감싼 자리표시자 3곳을 실제 값으로 바꾼 뒤 커밋하세요.

  PROJECT-FLUTTER-IOS-TESTFLIGHT / PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT 워크플로우가
  xcodebuild -exportArchive -exportOptionsPlist ExportOptions.plist 로 IPA를 만들 때 사용합니다.
  자리표시자가 남아 있으면 워크플로우가 중단됩니다.
  (이 주석에는 자리표시자를 적지 않았습니다. 값을 채운 뒤에도 남아 있는지 검사하기 때문입니다.)

    teamID                 Apple Developer Team ID (10자리, developer.apple.com 계정의 Membership)
    provisioningProfiles   키는 앱 번들 ID (예: com.example.app),
                           값은 프로비저닝 프로파일 이름 (GitHub Secret IOS_PROVISIONING_PROFILE_NAME 값과 같게)
-->
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>__TEAM_ID__</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>__BUNDLE_ID__</key>
    <string>__PROVISIONING_PROFILE_NAME__</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 5: 통과 확인**

Run: `node --test tests/node/flutter-app-templates.test.js`
Expected: 27 tests pass, 0 fail (macOS에서는 skip 0. ruby·plutil이 없는 환경에서는 해당 케이스만 skip).

Run: `ruby -c payload/flutter-app/ios/fastlane/Fastfile && plutil -lint payload/flutter-app/ios/ExportOptions.plist`
Expected: `Syntax OK` / `payload/flutter-app/ios/ExportOptions.plist: OK`

- [ ] **Step 6: 기존 페이로드 가드 통과 확인**

Run: `node --test tests/node/legacy-naming-guard.test.js tests/node/line-endings.test.js`
Expected: 모두 pass.

- [ ] **Step 8: 전체 Node 테스트 회귀 확인**

Run: `npm run test:node`
Expected: 이번 Task로 새로 실패하는 테스트 없음(이 Task는 `payload/flutter-app/`와 신규 테스트 파일만 추가한다).


### Task 27: 전체 검증 (코드 변경 없음)

**Files:**
- Modify: 없음 (검증만. 문제가 나오면 해당 Task의 파일을 고치고 이 Task를 다시 실행한다)

**Interfaces:**
- Consumes: Task 1~26의 모든 산출물
- Produces: 통과/실패 보고

- [ ] **Step 1: 전체 테스트**

Run: `cd /Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard && npm test 2>&1 | tail -40`
Expected: node·python 테스트 전부 통과 (실패 0). 실패가 있으면 어떤 Task의 산출물 때문인지 식별해 보고한다.

- [ ] **Step 2: actionlint — 수정된 워크플로우 전체 (치환 후 임시 사본)**

Run: `cd /Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard && node --test tests/node/ci-gate-payload.test.js tests/node/flutter-workflows-payload.test.js 2>&1 | tail -30`
Expected: 통과 (actionlint가 PATH에 있으므로 skip 없이 실행되어야 한다. skip이 보이면 `which actionlint`를 확인).

- [ ] **Step 3: 설치 스모크 — Flutter 모노레포, Android만 선택**

Run:
```bash
SP=/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/a405647a-5c94-4250-99d2-7c3a4a0061dc/scratchpad
ROOT=/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard
rm -rf "$SP/smoke" && mkdir -p "$SP/smoke/app" && cd "$SP/smoke" && git init -q && printf 'name: demo\nversion: 1.0.0+1\n' > app/pubspec.yaml
node "$ROOT/bin/project-auto-wizard.js" --mode full --force --type flutter --paths "flutter=app" --flutter-store android --flutter-env-mode dart-define --android-deploy-mode store_prepare 2>&1 | tail -15
ls .github/workflows | grep -E 'PLAYSTORE|TESTFLIGHT|FIREBASE|SELFHOSTED|TEST-APK|FLUTTER-CI'
ls app/android/fastlane app/ios 2>&1
grep -n 'env_mode\|flutter_store\|android_deploy_mode\|ios_deploy_mode' version.yml
grep -n 'paths:' .github/workflows/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml
grep -n "ENV_MODE\|FLUTTER_PROJECT_DIR:\|store_prepare" .github/workflows/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml | head
```
Expected: PLAYSTORE·FIREBASE·SELFHOSTED·TEST-APK·FLUTTER-CI 워크플로우가 있고 TESTFLIGHT 2종은 없다. `app/android/fastlane/Fastfile.playstore`가 있고 `app/ios`는 없다. `version.yml`에 4개 키(`env_mode: dart-define`, `flutter_store: android`, `android_deploy_mode: store_prepare`, `ios_deploy_mode: store_only`). PLAYSTORE에 `paths: ['app/**']`, `ENV_MODE: "dart-define"`, `FLUTTER_PROJECT_DIR: "app"`, 폴백 `'store_prepare'`.

- [ ] **Step 4: 재실행 — 스토어 대상을 none으로 바꾸면 정리된다**

Run:
```bash
SP=/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/a405647a-5c94-4250-99d2-7c3a4a0061dc/scratchpad
ROOT=/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard
cd "$SP/smoke" && node "$ROOT/bin/project-auto-wizard.js" --mode full --force --type flutter --paths "flutter=app" --flutter-store none 2>&1 | tail -10
ls .github/workflows | grep -E 'PLAYSTORE|TESTFLIGHT' ; echo "exit-grep=$?"
ls app/android/fastlane
grep -n 'flutter_store\|android_deploy_mode' version.yml
```
Expected: PLAYSTORE 워크플로우(미수정)가 삭제되어 grep 결과가 없고(`exit-grep=1`), `app/android/fastlane/Fastfile.playstore`는 그대로 남는다(사용자 소유). `version.yml`은 `flutter_store: none`이지만 `android_deploy_mode: store_prepare`(Step 3에서 설정한 값)는 그대로 남아 있다 — 스토어를 해제해도 배포 모드 저장값은 지워지지 않는다.

- [ ] **Step 5: 기존 설치는 dotenv 유지, 신규는 dart-define**

Run:
```bash
SP=/private/tmp/claude-501/-Users-chuseok22-Workspace-contests-open-soruce-code-project-auto-wizard/a405647a-5c94-4250-99d2-7c3a4a0061dc/scratchpad
ROOT=/Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard
rm -rf "$SP/legacy" && mkdir -p "$SP/legacy" && cd "$SP/legacy" && git init -q && printf 'name: demo\nversion: 1.0.0+1\n' > pubspec.yaml && printf 'version: "1.0.0"\nversion_code: 1\nproject_types: ["flutter"]\nmetadata:\n  template:\n    version: "0.9.0"\n' > version.yml
node "$ROOT/bin/project-auto-wizard.js" --mode full --force --type flutter 2>&1 | tail -5
grep -n 'env_mode' version.yml
grep -n 'ENV_MODE' .github/workflows/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml | head -3
```
Expected: 기존 `version.yml`이 있고 `env_mode` 저장값이 없었으므로 `env_mode: dotenv`, 워크플로우 `ENV_MODE: "dotenv"`.

- [ ] **Step 6: 변경 범위 확인**

Run: `cd /Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard && git status --short && git diff --stat | tail -5`
Expected: 이슈 범위의 파일만 변경/추가됨. `.issue/`나 스크래치 파일이 없고, 커밋·스테이징된 것이 없다(staged 0). 예상 밖 파일이 있으면 보고한다.

- [ ] **Step 7: 결과 보고**

실행한 명령과 결과(통과/실패 수, 스모크 결과)를 요약해 보고한다. 이 Task는 커밋하지 않는다.
